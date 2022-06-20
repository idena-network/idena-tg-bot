FROM node:16.15

# создание директории приложения
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

CMD node src/index.js | tee -a log 2>&1