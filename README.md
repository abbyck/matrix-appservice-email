# Matrix Email Bridge

This bridge enables users of Email and Matrix to communicate with each other on a Matrix room.

[This was made during Google Summer of Code 2021](https://matrix.org/blog/2021/05/20/google-summer-of-code-2021#abhinav-krishna-c-k-first-class-email-bridge).

### Features

* Sending and receiving messages between Email and Matrix
  * **Public Matrix rooms with room aliases:** By sending a mail to `room+test_example.com@example.com` (`example.com` is the homeserver where the bridge is enabled), a new user is automatically joined to the matrix room `#test:example.com`
  * **Direct Message rooms:** By sending a mail to `user+alice_example.com@example.com`, a DM room is created with the user `@alice:example.com` on Matrix
  * Subsequent replies on Matrix will be sent to the `from` address
* Signing outbound email with DKIM (*optional, recommended*)
* Using TLS while communicating with supported mail servers (*configuration required*)

#### To be implemented
* [Inbound spam protection](https://github.com/abbyck/matrix-appservice-email/issues/6): Running an email server publicly means that you have to fight a lot of spam
* [Attachments/File Handling](https://github.com/abbyck/matrix-appservice-email/issues/7)

### Setting up

To set up the bridge, follow these steps:

1. Run `git clone https://github.com/abbyck/matrix-appservice-email.git`
2. Install dependencies with `cd matrix-appservice-email && npm i`
3. Generate the Application Service registration file with `node app.js -r -u "http://localhost:8090" -f /config/email-registration.yaml` (http://localhost:8090 is the URL that the AS will listen to)
4. Add the registration details to your homeserver configuration by adding the `email-registration.yaml`
5. Make a copy of the sample `config/config-sample.yaml` and carefully change the options as required
6. Run the bridge with `node app.js -c config/config.yaml`

#### Recommended options for the bridge

Most of the available options are detailed on the sample configuration file. It's _highly recommended_ to configure the following settings to ensure email delivery.

* [MX records](https://www.cloudflare.com/en-in/learning/dns/dns-records/dns-mx-record/)
* [SPF records](https://en.wikipedia.org/wiki/Sender_Policy_Framework)
* [DKIM (DomainKeys Identified Mail)](https://en.wikipedia.org/wiki/DomainKeys_Identified_Mail)
  - You may use [opendkim-genkey](http://www.opendkim.org/opendkim-genkey.8.html) to generate the DKIM keys
* TLS keys for encrypted outbounds to supported servers

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

See something missing? Hit a message to [@abbyck:matrix.org](https://matrix.to/#/@abbyck:matrix.org).
