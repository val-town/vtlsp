FROM denoland/deno:2.3.6

COPY . /app
WORKDIR /app/deploy/server
RUN deno cache . --frozen=true

EXPOSE 5002

CMD ["deno", "run", "-A", "ls-server.ts"]
