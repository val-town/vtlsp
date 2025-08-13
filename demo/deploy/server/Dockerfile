FROM denoland/deno:2.3.6

# Install Rust and rust-analyzer
RUN apt-get update && apt-get install -y curl build-essential
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup component add rust-analyzer

COPY . /app
WORKDIR /app/deploy/server
RUN deno cache .

EXPOSE 5002

CMD ["deno", "run", "-A", "ls-server.ts"]
