export const api = {
  async get(path) {
    const resp = await fetch(path)
    if (!resp.ok) throw new Error(await resp.text())
    return resp.json()
  },
  async post(path, body, isJson = true) {
    const opts = { method: 'POST' }
    if (isJson) {
      opts.headers = { 'Content-Type': 'application/json' }
      opts.body = JSON.stringify(body)
    } else {
      opts.body = body
    }
    const resp = await fetch(path, opts)
    if (!resp.ok) throw new Error(await resp.text())
    return resp.json()
  },
  async delete(path) {
    const resp = await fetch(path, { method: 'DELETE' })
    if (!resp.ok) throw new Error(await resp.text())
    return resp.json()
  },
}
