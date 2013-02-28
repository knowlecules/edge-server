"use strict";

var fs = require('fs');
var http = require('http');
var lactate = require('lactate');
var rapidRest = require('rapid-rest');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var path = require('path');
var gm = require('gm');

/*
 * Edge Server options
 * subDirectoryResolver:   A function to resolve the subDirectory based on the image identity.
 *                      Default takes the last 5 bits of the ID. Created Directory names are cached
 * rootDirectory: path to the root Directory for the image files
 */

function EdgeServer(options) {
    var self = this;
    self.globalOpts = options;

    function serverError(req, res, msg) {
        res.writeHead(500);
        res.end(msg);
    }

    function methodFailure(req, res, msg) {
        res.writeHead(424);
        res.end(msg);
    }

    function notFound(req, res) {
        res.writeHead(404);
        res.end();
    }

    function notModified(req, res) {
        res.writeHead(304);
        res.end("Not Modified");
    }

    function respond(res, data) {
        res.writeHead(200);
        res.write(data);
        res.end();
    }

    function subDirectoryResolver(ref) {
        return parseInt((new Buffer(ref)).toString().substr(0,8), 16) & 0x7fff;
    }

    function uniqueNameResolver(ref) {
        self.hMac = crypto.createHmac("md5", 'secret');
        return self.hMac.update(ref).digest('hex');
    }

    function defaultUrlToCachePath(url) {
        var imageId = uniqueNameResolver(url),
            extension = path.extname(url),
            subDirectoryId = subDirectoryResolver(imageId);

        if (subDirectoryId && !(new RegExp("\/" + subDirectoryId + "\/")).test(url)) { //
            return "/" + subDirectoryId + "/" + imageId + extension;
        }
        return url;
    }

    this.dirs = {};
    this.routes = rapidRest();

    // Listen on a port or optionally create a server
    this.listen = function (port, options) {
        if (false === (this instanceof EdgeServer)) {
            return new EdgeServer(options);
        }
        this.routes.listen(port);
    };

    /*
        "urlToOriginHostPath" :  urlPathOfOriginalImage,
        "urlToCachePath" :  idEmbeddedUrlToCachePath,
        "originHost" :  originHost,
        "rootDirectory" : "./assets"
      */

    // Routes to match on
    this.routeImages = function (routeDesc, options, next) {
        var opts = {
            "rootDirectory" : options.rootDirectory || "./assets",
            "maxHeight" : 2400,
            "maxWidth" : 3200,
            "urlToCachePath" : options.urlToCachePath || defaultUrlToCachePath,
            "originHost" : options.originHost || "",
            "originPort" : options.originPort || 80,
            "urlToOriginHostPath" : options.urlToOriginHostPath || function (ref) {return ref; }
        }, lactateOpts = {
            "cluster" : self.globalOpts.cluster,
            "redis_cache" : self.globalOpts.redis_cache,
            "cache" : self.globalOpts.cache,
            "not_found" : options.cacheMissHandler || notFound,
            "match" : ""
        }, lactateDir;

        if (opts.originHost) {
            lactateOpts.not_found = function (req, origRes) {
                var proxyOptions = {
                    host: opts.originHost,
                    port: opts.originPort,
                    path: opts.urlToOriginHostPath(req.origUrl)
                }, proxyReq = http.get(proxyOptions, function (res) {
                    var edgeData = '', headerJson = JSON.stringify(res.headers).toLowerCase(),
                        isNotCacheable = headerJson.indexOf("no-cache") > -1 || (res.headers["Cache-Control"] && res.headers["Cache-Control"].indexOf("private") > -1);

                    res.setEncoding('binary');
                    origRes.headers = res.headers; //{"content-type": res.headers["content-type"], "cache-control": res.headers["cache-control"]};

                    res.on('data', isNotCacheable ? function (chunk) {
                        origRes.write(chunk);
                    } : function (chunk) {
                        edgeData += chunk;
                    });

                    res.on('end', isNotCacheable ? function () {
                        origRes.end();
                    } : function () {
                        var filePath =  opts.rootDirectory + (req.origUrl ? req.url : this.opts.urlToCachePath(req.url));
                        mkdirp(filePath.replace(/([\\\/][^\\\/\.]*\.\w*)$/, ""), function (e) {
                            if (!e || (e && e.code === 'EEXIST')) {
                                fs.writeFile(filePath, edgeData, 'binary', function (err) {
                                    if (err) {
                                        //Unable to cache locally so log the reason and forward the file
                                        lactateDir.emit('error', err, req, origRes);
                                        respond(origRes, edgeData);
                                    } else {
                                        lactateDir.setCache(req, new Buffer(edgeData));
                                        lactateDir.emit('original-retrieved', req, origRes);
                                    }
                                });
                            } else {
                                //Unable to cache locally so log the reason and forward the file
                                lactateDir.emit('error', e, req, origRes);
                                respond(origRes, edgeData);
                            }
                        });
                    });
                });

                proxyReq.on('error', function (e) {
                    lactateDir.emit('error', e, req, origRes);
                });
            };
        }

        lactateDir = self.dirs[routeDesc] = lactate.dir(opts.rootDirectory, lactateOpts);

        self.routes(routeDesc)('get', function (req, res, params, jsonData) {
            var width = parseInt(params.width, 10),
                height = parseInt(params.height, 10);
            req.origUrl = req.url;
            if (width > 0  || height > 0) {
                if (width > opts.maxWidth || height > opts.maxHeight) {
                    methodFailure(req, res, "Image resize request exceeded boundaries (" + opts.maxWidth + " w, " + opts.maxHeight + " h)");
                }
                req.reformat = opts.imageManipulator || function (readStream, res) {
                    gm(readStream, 'img.jpg').resize(width, height).stream(
                        function (err, stdOut, stdErr) {
                            if (err) {
                                lactateDir.emit('error', err, req, res);
                                methodFailure(req, res, "Unable to resize image. " + err.message);
                            }
                            stdOut.pipe(res);
                        }
                    );
                };
            }
            // Validate caching state
            if (req.headers["if-modified-since"] || req.headers["if-none-match"]) {
                var proxyOptions = {
                    host: opts.originHost,
                    port: opts.originPort,
                    path: opts.urlToOriginHostPath(req.origUrl)
                }, edgeData = "", proxyReq = http.get(proxyOptions, function (proxyRes) {
                    proxyRes.setEncoding('binary');
                    res.headers = proxyRes.headers;
                    req.url = opts.urlToCachePath(req.url);
                    if (proxyRes.statusCode === 200) {
                        opts.not_found(req, res);
                    } else {
                        lactateDir.serve(req, res);
                    }
                });

                proxyReq.on('error', function (e) {
                    lactateDir.emit('error', e, req, res);
                });
            } else {
                req.url = opts.urlToCachePath(req.url);
                lactateDir.serve(req, res);
            }
        });
        lactateDir.on('original-retrieved', function (req, res) {
            lactateDir.serve(req, res);
        });

        lactateDir.on('error', function (err, req, res) {
            //TODO: winston
            console.log(err.message);
            serverError(req, res, err.message);
        });
    };


}
module.exports.EdgeServer = EdgeServer;

