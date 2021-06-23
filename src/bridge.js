const { Bridge } = require('matrix-appservice-bridge');
const { startSMTP } = require('./email');
const { Logging } = require('./log');

const log = Logging.get("bridge");

exports.bridge = function(port, config) {
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
                log.info(`Matrix-side: ${event.sender}: ${event.content.body}`)
            }
        }
    });
    log.info("Matrix-side listening on port:", port);
    startSMTP.listen(2525);
    bridge.run(port, config);
}
