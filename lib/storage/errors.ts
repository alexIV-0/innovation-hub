export class StorageWriteError extends Error {
  readonly status: number

  constructor(message: string, status = 409) {
    super(message)
    this.name = "StorageWriteError"
    this.status = status
  }
}
