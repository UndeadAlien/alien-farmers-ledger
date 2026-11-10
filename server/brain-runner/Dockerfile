FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.63.0 && mkdir -p /data && chown pwuser:pwuser /data
COPY runner.mjs .
USER pwuser
CMD ["node", "runner.mjs"]
