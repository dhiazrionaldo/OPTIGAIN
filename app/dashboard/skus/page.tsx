"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";


type SKU = {
  id: string;
  sku_code: string;
  product_name: string;
  category: string;
  base_price: number;
  base_cost: number;
};

// Dummy fetch functions (replace with real API calls)
async function fetchSKUs(): Promise<SKU[]> {
  const res = await fetch("/api/skus");
  return res.json();
}
async function addSKU(sku: Omit<SKU, "id">): Promise<void> {
  await fetch("/api/skus", { method: "POST", body: JSON.stringify(sku) });
}
async function deleteSKU(id: string): Promise<void> {
  await fetch(`/api/skus/${id}`, { method: "DELETE" });
}

export default function SKUMastersPage() {
  const [skus, setSkus] = useState<SKU[]>([]);
  const [categories, setCategories] = useState<Array<string>>([]);
  const [specs, setSpecs] = useState<Array<string>>([]);
  const [form, setForm] = useState({
    sku_code: "",
    product_name: "",
    category: "",
    base_price: "",
    base_cost: "",
  });
  const [productNames, setProductNames] = useState<Array<string>>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    fetchSKUs().then(setSkus);
    fetch("/api/skus/categories").then(res => res.json()).then(setCategories);
  }, []);


  const handleFetchSpecs = async (): Promise<void> => {
    const res = await fetch("/api/skus/product-specs");
    const data: string[] = await res.json();
    setSpecs((prev) => Array.from(new Set([...prev, ...data])));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!form.product_name || !form.category) {
      alert("Please select a product name and category.");
      return;
    }
    setLoading(true);
    await addSKU({
      sku_code: form.sku_code,
      product_name: form.product_name,
      category: form.category,
      base_price: parseFloat(form.base_price),
      base_cost: parseFloat(form.base_cost),
    });
    setForm({ sku_code: "", product_name: "", category: "", base_price: "", base_cost: "" });
    setSkus(await fetchSKUs());
    setLoading(false);
    setOpen(false);
  };

  const handleDelete = async (id: string): Promise<void> => {
    setLoading(true);
    await deleteSKU(id);
    setSkus(await fetchSKUs());
    setLoading(false);
  };

  const handleFetchProductNames = async (): Promise<void> => {
    const res = await fetch("/api/skus/product-names");
    const data: string[] = await res.json();
    setProductNames((prev) => Array.from(new Set([...prev, ...data])));
  };

  // Pagination logic
  const totalPages = Math.ceil(skus.length / pageSize);
  const pagedSkus = skus.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">SKU Masters</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="default">Add SKU</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add SKU</DialogTitle>
            </DialogHeader>
            <form className="flex flex-wrap gap-4 items-end" onSubmit={handleSubmit}>
              <Input name="sku_code" placeholder="SKU Code" value={form.sku_code} onChange={handleChange} required />
              <select
                name="product_name"
                value={form.product_name}
                onChange={handleChange}
                onFocus={handleFetchProductNames}
                required
                className="w-full h-10 px-3 py-2 border border-input bg-background rounded-md text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 scrollbar-hide"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                <option value="" disabled>
                  Select Product Name
                </option>
                {productNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                onFocus={handleFetchSpecs}
                required
                className="w-full h-10 px-3 py-2 border border-input bg-background rounded-md text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 scrollbar-hide"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                <option value="" disabled>
                  Select Category
                </option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                {specs.map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))}
              </select>
              <Input name="base_price" placeholder="Base Price" type="number" value={form.base_price} onChange={handleChange} required />
              <Input name="base_cost" placeholder="Base Cost" type="number" value={form.base_cost} onChange={handleChange} required />
              <Button type="submit" disabled={loading}>Add SKU</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">SKU Code</TableCell>
              <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Product Name</TableCell>
              <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Category</TableCell>
              <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Base Price</TableCell>
              <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">Base Cost</TableCell>
              <TableCell className="font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right">Actions</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedSkus.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No SKUs found.
                </TableCell>
              </TableRow>
            ) : (
              pagedSkus.map((sku) => (
                <TableRow key={sku.id} className="border-border group hover:bg-secondary/40 transition-colors">
                  <TableCell>{sku.sku_code}</TableCell>
                  <TableCell>{sku.product_name}</TableCell>
                  <TableCell>{sku.category}</TableCell>
                  <TableCell>{sku.base_price}</TableCell>
                  <TableCell>{sku.base_cost}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(sku.id)} disabled={loading}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {/* Pagination Controls */}
        <div className="flex justify-between items-center p-4 border-t bg-muted/50">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
