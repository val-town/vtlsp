FROM denoland/deno:2.4.0 AS builder

WORKDIR /app
COPY . .
ENV DENO_DIR=/app/.deno_dir
RUN deno cache --frozen=true .

FROM denoland/deno:2.4.0

RUN apt-get update && apt-get install -y busybox procps tree && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app .
COPY --from=builder /app/.deno_dir /app/.deno_dir
ENV DENO_DIR=/app/.deno_dir

EXPOSE 5002

CMD ["deno", "run", "-A", "server/lsp-server.ts"]