const { Bridge } = require('matrix-appservice-bridge');
const { startSMTP } = require('./email');
const { Logging } = require('./log');

const log = Logging.get("bridge");

exports.bridge = function(port, config) {
    bridge = new Bridge({
        homeserverUrl: config.bridge.homeserverUrl,
        domain: config.bridge.domain,
        registration: "email-registration.yaml",

        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additonal data
            },

            onEvent: function(request, context) {
                // events from matrix
                const event = request.getData();
                log.debug("Incoming event:", event);
                if (event.type !== "m.room.message" || !event.content) {
                    return;
                }
                log.info(`Matrix-side: ${event.sender}: ${event.content.body}
                RoomID: ${event.room_id}, EventID: ${event.event_id} 
                `);
            }
        }
    });
    log.info("Matrix-side listening on port:", port);
    process.on('SIGINT', async () => {
        // Handle Ctrl-C
        log.info(`Closing bridge due to SIGINT`);
        try {
            await bridge.appService.close();
            process.exit(0);
        }
        catch (ex) {
            log.error(`Ungraceful shutdown:`, ex);
            process.exit(1);
        }
    });
    startSMTP(config);
    bridge.run(port, config);
};
