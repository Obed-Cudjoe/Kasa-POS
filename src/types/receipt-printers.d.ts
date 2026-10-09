declare module '@point-of-sale/webbluetooth-receipt-printer' {
  export default class WebBluetoothReceiptPrinter {
    addEventListener(event: string, callback: (device: { type?: string; id?: string; name?: string; language?: string; columns?: number; codepageMapping?: Record<string, number> }) => void): void
    connect(): Promise<void> | void
    print(data: Uint8Array): Promise<void>
  }
}

declare module '@point-of-sale/webusb-receipt-printer' {
  export default class WebUSBReceiptPrinter {
    addEventListener(event: string, callback: (device: { type?: string; id?: string; name?: string; language?: string; columns?: number; codepageMapping?: Record<string, number> }) => void): void
    connect(): Promise<void> | void
    print(data: Uint8Array): Promise<void>
  }
}
