const { Logging } = require("matrix-appservice-bridge");

Logging.configure({
    // A level to set the console reporter to.
    console: "debug",

    // // Format to append to log files.
    // fileDatePattern: "DD-MM-YYYY",

    // // Format of the timestamp in log files.
    // timestampFormat: "MMM-D HH:mm:ss.SSS",

    // // Log files to emit to, keyed of the minimum level they report.
    // // You can leave this out, or set it to false to disable files.
    // files: {
    //     // File paths can be relative or absolute, the date is appended onto the end.
    //     "info.log": "info",
    // },

    // // The maximum number of files per level before old files get cleaned
    // // up. Use 0 to disable.
    // maxFiles: 5,
})

exports.Logging = Logging;
