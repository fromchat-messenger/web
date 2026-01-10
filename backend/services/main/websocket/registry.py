from typing import Callable


class WebSocketHandlerRegistry:
    """Registry for WebSocket message handlers with authentication support."""
    
    def __init__(self):
        self._handlers: dict[str, tuple[Callable, bool]] = {}
    
    def register(self, message_type: str, authRequired: bool = True):
        """Register a handler for a message type.
        
        Args:
            message_type: The WebSocket message type to handle
            authRequired: If True, handler will receive authenticated User (not None) or raise 401
        """
        def decorator(func: Callable):
            self._handlers[message_type] = (func, authRequired)
            return func
        return decorator
    
    def get_handler(self, message_type: str) -> tuple[Callable, bool] | None:
        """Get handler and authRequired flag for a message type.
        
        Returns:
            Tuple of (handler function, authRequired flag) or None if not found
        """
        return self._handlers.get(message_type)
    
    def get_all_types(self) -> list[str]:
        """Get all registered message types for debugging/logging."""
        return list(self._handlers.keys())

