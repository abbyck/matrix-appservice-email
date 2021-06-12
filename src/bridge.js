const Bridge = require('matrix-appservice-bridge').Bridge;
const {startSMTP}= require('./email');

module.exports.bridge = function(port, config) {
    bridge = new Bridge({
        homeserverUrl: "http://localhost:8008",
        domain: "localhost",
        registration: "email-registration.yaml",

        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additonal data
            },

            onEvent: function(request, context) {
                // events from matrix
                const event = request.getData();
                console.log(event)
                if (event.type !== "m.room.message" || !event.content) {
                    return;
                }
                console.log(`${event.sender}: ${event.content.body}`)
            }
        }
    });
    console.log("Matrix-side listening on port %s", port);
    startSMTP.listen(2525);
    bridge.run(port, config);
}
