export const offlineState = $state<{ status: 'preparing' | 'ready' | 'unavailable' | 'error' }>({
	status: 'preparing'
});
