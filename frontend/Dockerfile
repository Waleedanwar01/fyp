FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

# Dev-only image: runs Next's dev server with hot reload against the
# source tree mounted in by docker-compose. Not tuned for production
# (no multi-stage build, no `next build`/`next start`) -- that's a
# separate concern from getting local Docker dev running.
CMD ["npm", "run", "dev"]
