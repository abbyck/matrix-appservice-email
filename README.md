# Matrix Email Bridge

First class email bridge for Matrix.  
This bridge enables Email users and Matrix users to communicate back and forth.



### Setup:

To set up the bridge, simply clone this repository.

1. `git clone https://github.com/abbyck/matrix-appservice-email.git`
2. Install the dependencies `cd matrix-appservice-email && npm i`
3. Generate the Application Service registration file with
`node app.js -r -u "http://localhost:8090" -f /config/email-registration.yaml`.<br />http://localhost:8090 is the URL that the AS will listen to.
4. Add the registration details to your homeserver configuration by adding the `email-registration.yaml`.
5. Make a copy of the sample `config/config-sample.yaml` and carefully change the options as required.
6. Run the bridge!
```node app.js -c config/config.yaml```

#### Recommended options for the bridge.
Most of the available options are detailed on the sample configuration file.  
It's _highly recommended to use_ the following settings to ensure email delivery.
* [DKIM (DomainKeys Identified Mail)](https://en.wikipedia.org/wiki/DomainKeys_Identified_Mail).
    - You may use [opendkim-genkey](http://www.opendkim.org/opendkim-genkey.8.html) to generate the DKIM keys.
* TLS Keys for encrypted outbounds to supported servers.
### Docker

A Dockerfile is included. To use it:

```sh
# To build a docker image
docker build . -t matrix-appservice-email
# Create a new config file
mkdir data
cp config/config.yaml data/config.yaml
# ...and edit that file.
# Generate a registration file
docker run --rm -v $PWD/data:/config matrix-appservice-email node app.js -r -u "http://localhost:8090" -f /config/email-registration.yaml
# To run with default ports (port 25 for SMTP, port 8090 for bridge traffic)
docker run --rm -v $PWD/data:/config matrix-appservice-email
# To run with custom ports
docker run --rm -v $PWD/data:/config -p 127.0.0.1:25:1111/tcp  -p 127.0.0.1:8090:2222/tcp matrix-appservice-email
```

### Features
* Email users can join public Matrix rooms which has room aliases.
  * To join a room, send an email to `room+test_matrix@matrix.org` and the user would be automatically joined to a 
  matrix room `#test:example.com`
  * Subsequent replies will be sent to the `from` address.
* They can send and receive messages to Matrix rooms.
* Outbound mails have the ability to get DKIM signed and,
* Use TLS while communicating with supported mail servers (Configuration required).

#### To be implemented
* [Inbound spam protection](https://github.com/abbyck/matrix-appservice-email/issues/6): Running an email server 
publicly means, you have to fight a lot of spam
* [DM support](https://github.com/abbyck/matrix-appservice-email/issues/8): Direct message between Matrix users and email users.
* [Attachments/File Handling](https://github.com/abbyck/matrix-appservice-email/issues/7)

See something missing? Hit a message to [@abbyck:matrix.org](https://matrix.to/#/@abbyck:matrix.org).
