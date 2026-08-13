import { NextResponse } from "next/server"

export function apiError(message: string, status: number) {
  return NextResponse.json({ message }, { status })
}

export function apiOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
