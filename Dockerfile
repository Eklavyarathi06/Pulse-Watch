# Single image: the API serves the built web app (one origin = first-party cookies, no CORS).
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production SERVE_CLIENT=true PORT=5000
WORKDIR /app
COPY server/package*.json server/
RUN npm ci --prefix server --omit=dev
COPY server/ server/
COPY --from=client /app/client/dist client/dist
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["node", "server/src/server.js"]
