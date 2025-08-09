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

# Pre-cache ValTown types
RUN deno cache --allow-import "https://www.val.town/types/valtown.d.ts"

EXPOSE 5002

CMD ["./supervisor.ts", "deno", "run", "-A", "./lsp-server/main.ts", "--port=5002", "--host=0.0.0.0", "--ls-command=deno", "--ls-args=run,-A,./lsp-ls/main.ts", "--max-processes=1"]
