const fs = require("fs");
const { Bridge } = require('matrix-appservice-bridge');
const { startSMTP } = require('./email');
const { Logging } = require('./log');

const sendMail = require('./email/outbound')({
    // dkim false for now
    // dkim: {
    //     privateKey: fs.readFileSync(config.bridge.dkimPrivateKeyLocation, 'utf8'),
    //     keySelector: config.bridge.dkimSelector,
    // },
    devPort: 2500,
    devHost: 'localhost',
    smtpPort: 2500,
    smtpHost: 'localhost'
});

const log = Logging.get("bridge");

exports.bridge = async function(port, config, registration) {
    bridge = new Bridge({
        homeserverUrl: config.bridge.homeserverUrl,
        domain: config.bridge.domain,
        registration,

        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additional data
            },

            onEvent: function(request, context) {
                // events from matrix
                const event = request.getData();
                if (event.type !== "m.room.message" || !event.content) {
                    return;
                }
                log.info(`Matrix-side: ${event.sender}: ${event.content.body}
                RoomID: ${event.room_id}, EventID: ${event.event_id} 
                `);
                sendMail({
                    from: 'room+email_localhost@matrix.org',
                    to: 'user@localhost',
                    subject: `You have a message from ${event.sender}`,
                    html: `${event.content.body}`,
                }, function(err, reply) {
                    if (!err) {
                        log.info('mail sent');
                    }
                    log.error(err && err.stack);
                    log.info('reply', reply);
                });

            }
        }
    });
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

    // Check if the homeserver is up yet.
    let ready = false;
    await bridge.initalise();
    do {
        try {
            log.info(`Checking connection to the HS..`);
            // Simple call.
            await bridge.botClient.getVersions();
            log.info(`HS connection ready`);
            break;
        }
        catch (ex) {
            log.error('Could not verify HS connection, retrying in 5s.');
            await new Promise(res => setTimeout(res, 5000)); // Wait 5s before reattempting
        }
    } while (!ready);

    startSMTP(config);
    bridge.listen(port, config);
    log.info("Matrix-side listening on port:", port);
};
