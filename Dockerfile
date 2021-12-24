FROM node:14

# создание директории приложения
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

CMD [ "node", "src/index.js", "|&", "tee", "-a", "log"]