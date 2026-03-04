FROM oven/bun:latest
COPY ["package.json", "bun.lock", "./"]
RUN ["bun", "i"]
CMD ["bun", "run", "dev"]
