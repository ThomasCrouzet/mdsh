.PHONY: dev

# Lance le dev server Vite accessible via Tailscale.
# Bind sur l'IP Tailscale uniquement (pas sur 0.0.0.0) pour limiter l'exposition.
dev:
	@TAILSCALE_IP=$$(tailscale ip -4 2>/dev/null | head -1); \
	if [ -z "$$TAILSCALE_IP" ]; then \
		echo "⚠ Tailscale indisponible - bind sur toutes les interfaces"; \
		npm run dev -- --host; \
	else \
		echo "▸ Dev server : http://$$TAILSCALE_IP:5173/"; \
		npm run dev -- --host $$TAILSCALE_IP; \
	fi
