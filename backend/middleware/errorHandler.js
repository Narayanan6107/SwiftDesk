/**
 * Centralised error handler middleware.
 * Catches errors thrown anywhere in the request lifecycle.
 */
const errorHandler = (err, _req, res, _next) => {
  console.error('[Error]', err.message);

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Creates an error with a given HTTP status code.
 */
const createError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

module.exports = { errorHandler, createError };
