export class ItineraryLoadError extends Error {
  constructor(code, message, { path = '$', issues = [], cause } = {}) {
    super(message, { cause });
    this.name = 'ItineraryLoadError';
    this.code = code;
    this.path = path;
    this.issues = issues;
  }
}
