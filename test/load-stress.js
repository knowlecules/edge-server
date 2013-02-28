"use strict";
var http = require('http');

function LogIntervals(lastLogTime, start, iteration) {
    var interval = parseFloat(process.hrtime().join(".")) - lastLogTime,
        intervalMatch = interval.toString().match(/(\d+\.\d{0,3})/),
        intervalFmt = intervalMatch === null ? "0" :  intervalMatch[1],
        nowTime = parseFloat(process.hrtime().join(".")),
        dateDiffMatch = ((nowTime - start).toString()).match(/^(\d*\.\d{0,3})/),
        dateDiffFmt = dateDiffMatch === null ? "0" :  dateDiffMatch[1];
    console.log("Pulled image number " + iteration  + " after " + dateDiffFmt  + "s interval " + intervalFmt + "s.");
    return nowTime;
}

var lastId = 22578639;
var currentId = lastId + 1;
var options = {
    host: 'localhost',
    port: 8800,
    method: 'GET'
};

var start;
var iDone = 0;
if (!start) {
    start = parseFloat( process.hrtime().join("."));
}

function logOnInterval() {
    if (++iDone >= LOG_INTERVAL) {
        LogIntervals(parseFloat(process.hrtime().join(".")), start, iDone);
        iDone = 0;
    }
}
var lastLogTime;
function getImage(imageId) {
    options.path = "/ProductsImages/0/0/" + imageId + ".jpg";

    var req = http.get(options, function (res) {
        if (res.statusCode < 400 ) {
            if (++iDone === LOG_INTERVAL) {
                LogIntervals(lastLogTime, start, imageId);
                lastLogTime = parseFloat(process.hrtime().join("."));
                iDone = 0;
            }
        } else {
            if (res.statusCode != 404)
            {
                console.log('problem with request: ' + options.path + " ," + res.statusCode + ' = ' + JSON.stringify(res.headers));
            }
        }
        if (currentId > 0) {
            getImage( --currentId);
        }
    });

    req.on('error', function (e) {
        console.log('problem with request for:' + options.path);
    });

}

var LOG_INTERVAL = 500;
while (currentId > lastId - 100) {
    currentId -= 1;
    getImage(currentId);
}
