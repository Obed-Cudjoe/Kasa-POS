-- Add optional store-unique barcode values for keyboard-wedge USB/Bluetooth scanners.
-- Existing products remain valid and can be assigned barcodes later by the owner.
ALTER TABLE products ADD COLUMN barcode TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX IF NOT EXISTS products_store_barcode_uq
  ON products(store_id, barcode)
  WHERE barcode IS NOT NULL;
