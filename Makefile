.PHONY: dev dev-tailnet

# Run the development server on the loopback interface only.
dev:
	npm run dev -- --host 127.0.0.1

# Explicitly expose the development server on the Tailscale address.
dev-tailnet:
	@TAILSCALE_IP=$$(tailscale ip -4 2>/dev/null | head -1); \
	if [ -z "$$TAILSCALE_IP" ]; then \
		echo "Tailscale is unavailable; no server was started"; \
		exit 1; \
	else \
		echo "Development server: http://$$TAILSCALE_IP:5173/"; \
		npm run dev -- --host $$TAILSCALE_IP; \
	fi
