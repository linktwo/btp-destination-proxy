/** The subset of the @ui5/logger API this package uses. UI5 Tooling passes it to the middleware as `log`. */
export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  verbose(message: string): void;
}
