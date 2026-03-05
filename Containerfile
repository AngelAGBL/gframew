FROM oven/bun:alpine
RUN apk add --no-cache openssl\
 && openssl req -x509 -nodes -days 365 -keyout server.key -out server.crt \
  -newkey rsa:2048 -subj "/CN=localhost" -addext "subjectAltName = DNS:localhost"
COPY ["./", "./"]
RUN ["bun", "i"]
CMD ["bun", "run", "start"]
