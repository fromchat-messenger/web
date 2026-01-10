from .registry import WebSocketHandlerRegistry

# Note: handler_registry and websocket_handler are not imported here to avoid circular dependency
# Import them directly from .handlers when needed

__all__ = ["WebSocketHandlerRegistry"]

