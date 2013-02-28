"use strict";
var path = require('path');

var edgeSvr = require('./../lib/edgeServer');
var port = 8801;

function first5chars(ref) {
    return ((ref || "") + "00000").substr(0, 5);
}

// http://localhost:8800/ProductsImages/0/0/Nissan-Sentra-2013-21229771.jpg
function extractImageUid(ref) {
    var uidParts =  /\/(\d+)\/(\d+)\/(.+)?\b(\d+)\b\.(jpe?g|gif|png)/.exec(ref);
    return uidParts[4] + "_" + uidParts[2] + "_" + uidParts[1];
}

// Convert a URL into a local path to compartmentalize the media.
function idEmbeddedUrlToRelativePath(url) {
    var imageId = extractImageUid(url),
        extension = path.extname(url),
        subDirectoryId = first5chars(imageId);

    if (subDirectoryId && !(new RegExp("\/" + subDirectoryId + "\/")).test(url)) { //
        return "/" + subDirectoryId + "/" + imageId + extension;
    }
    return url;
}

var edgeSvrOptions = {
    "urlToRelativePath" :  idEmbeddedUrlToRelativePath,
    "originHost" :  "www.autoaz.com",
    "cluster" : true,
    "redis_cache" : false,
    "rootDirectory" : "./images"

};


var edgeServer = new edgeSvr.EdgeServer(edgeSvrOptions);
edgeServer.routeImages('/ProductsImages/:width/:height/:fileName');  //optional "?source=origin"
edgeServer.listen(port);

