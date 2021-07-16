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
    smtpPort: 25,
    smtpHost: -1
});

const log = Logging.get("bridge");


exports.bridge = function(port, config) {
    bridge = new Bridge({
        homeserverUrl: config.bridge.homeserverUrl,
        domain: config.bridge.domain,
        registration: "email-registration.yaml",

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
                log.info('sending mail');
                sendMail({
                    from: 'room+email_localhost@matrix.org',
                    to: 'user@localhost',
                    subject: `You have a message from ${event.sender}`,
                    html: `${event.content.body}`,
                }, function(err, reply) {
                    console.log(err && err.stack);
                    console.dir(reply);
                });
                log.info('mail sent');
            }
        }
    });
    log.info("Matrix-side listening on port:", port);
    startSMTP(config);
    bridge.run(port, config);
};
