FROM node:25-alpine
WORKDIR /app
COPY ["package.json", "./"]
RUN ["npm", "install"]
EXPOSE 1965
CMD ["src/app.ts"]
COPY ["./", "./"]