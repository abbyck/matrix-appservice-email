FROM node:16-slim

WORKDIR /app
COPY . .
RUN npm ci

EXPOSE 587/tcp
EXPOSE 8090/tcp

VOLUME ["/config"]
ENTRYPOINT [ "node", "app.js", "-c", "/config/config.yaml" ]
CMD [ "-p", "5858", "-f", "/config/email-registration.yaml" ]
