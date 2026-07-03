# cwpt-engine — sequences sidecar inside the Chatwoot stack.
# Build context = modules/sequences (provides both engine/ and webapp/dist).
FROM node:22-alpine
WORKDIR /app

# תלויות תחילה (cache layer)
COPY engine/package.json ./
RUN npm install --omit=dev

# קוד ה-engine
COPY engine/src ./src
COPY engine/migrations ./migrations

# ה-Web App הבנוי (מוגש סטטית same-origin)
COPY webapp/dist /app/webapp-dist
ENV WEBAPP_DIST=/app/webapp-dist

CMD ["node", "src/index.js"]
