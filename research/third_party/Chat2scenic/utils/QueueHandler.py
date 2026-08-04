import logging


class QueueHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.log_buffer = []
        self.formatter = logging.Formatter(
            '%(message)s'
        )

    def emit(self, record):
        try:
            msg = self.format(record)
            self.log_buffer.append(msg)
            if len(self.log_buffer) > 1000:
                self.log_buffer.pop(0)
        except Exception:
            self.handleError(record)

    def get_logs(self):
        return "\n".join(self.log_buffer)

    def clear(self):
        self.log_buffer = []
