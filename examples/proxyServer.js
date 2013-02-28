"use strict";
var path = require('path');

var edgeSvr = require('./../lib/edgeServer');
var port = 8800;

function first5chars(ref) {
    return ((ref || "") + "00000").substr(0, 5);
}

// http://localhost:8800/ProductsImages/0/0/Nissan-Sentra-2013-21229771.jpg
function extractImageUid(ref) {
    var uidParts =  /\/(\d+)\/(\d+)\/(.+)?\b(\d+)\b\.(jpe?g|gif|png)/.exec(ref);
    return uidParts[4]; // + "_" + uidParts[2] + "_" + uidParts[1];
}

// Convert a URL into a local path to compartmentalize the media.
function idEmbeddedUrlToCachePath(url) {
    var imageId = extractImageUid(url),
        extension = path.extname(url),
        subDirectoryId = first5chars(imageId);

    if (subDirectoryId && !(new RegExp("\/" + subDirectoryId + "\/")).test(url)) { //
        return "/" + subDirectoryId + "/" + imageId + extension;
    }
    return url;
}

// Convert a URL into a local path to compartmentalize the media.
function urlPathOfOriginalImage(url) {
    return '/ProductsImages/0/0/' + extractImageUid(url) + path.extname(url);
}

var originHost = "localhost";//"www.autoaz.com";
var originPort = 59763;
var edgeSvrOptions = {
    "cluster" : true,
    "redis_cache" : false,
    "cache" : false
};
var edgeServer = new edgeSvr.EdgeServer(edgeSvrOptions);

var routeOptions = {
    "urlToOriginHostPath" :  urlPathOfOriginalImage,
    "urlToCachePath" :  idEmbeddedUrlToCachePath,
    "originHost" :  originHost,
    "originPort" :  originPort,
    "rootDirectory" : "./assets",
    "imageManipulator": ""           //Using default image resize manipulator
};

edgeServer.routeImages('/ProductsImages/:ignore_width_to_retain_proportions/:height/:fileName', routeOptions);  //optional "?source=origin"
edgeServer.listen(port);

