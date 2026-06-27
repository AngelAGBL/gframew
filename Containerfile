FROM node:25-alpine
# Interpreters for dynamic script routes (.py/.sh/.bash/.zsh).
RUN apk add --no-cache python3 bash zsh
WORKDIR /app
COPY ["package.json", "./"]
RUN ["npm", "install"]
EXPOSE 1965
CMD ["src/app.ts"]
COPY ["./", "./"]
