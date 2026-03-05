# gframew

A dead simple gemini server-side framework written in typescript with bun.

# features

You should put your public files in public dir, this Framework/Server parses all gemini
(and .hbs) files with handlebars.js to dinamically edit the served page, there are some
predefined helpers in handlebars: ansi and unicode, you can see an example of them in
the index.gmi in the public dir, if you want more helpers you should write your code in
the src dir, if you want to contribute, you can create create a PR

# How to use

This framework is bundled in a docker image, so you can just run
`docker compose up -d` to get started with it

# Hey, I just only want to use it as a server!

Yeah, if you dont like programming you can simple serve standard gemini files and static
content in the public dir
