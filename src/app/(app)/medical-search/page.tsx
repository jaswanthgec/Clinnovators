"use client";

import { useState, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Search, Pill, AlertCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ScrapedMedicineResult } from '@/types';
import { searchPharmaciesAction } from './actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function MedicalSearchPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<ScrapedMedicineResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchedTermDisplay, setSearchedTermDisplay] = useState<string>('');


  const handleSearch = async (e?: FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) {
      setError('Please enter a medicine name to search.');
      setResults([]);
      setSearchedTermDisplay('');
      return;
    }
    
    const currentSearch = searchTerm.trim();
    setSearchedTermDisplay(currentSearch);
    setIsLoading(true);
    setError(null);
    setResults([]);

    try {
      const actionResult = await searchPharmaciesAction(currentSearch);
      if (actionResult.error) {
        setError(actionResult.error);
        setResults([]);
      } else {
        setResults(actionResult.data || []);
        if ((actionResult.data || []).length === 0) {
            setError(`No results found for "${currentSearch}". Try checking the spelling or using a more generic name.`);
        }
      }
    } catch (err: any) {
      console.error("Medical search error:", err);
      setError("An unexpected error occurred while fetching results. Please try again.");
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-2 px-0 md:px-4 space-y-6">
      <Card className="shadow-lg border-border bg-card">
        <CardHeader className="text-center p-6 border-b border-border">
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground">Medicine Search</CardTitle>
          <CardDescription className="text-md">
            Compare medicine prices across different pharmacies
          </CardDescription>
        </CardHeader>
        
        <CardContent className="p-6 space-y-4">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-center gap-3">
            <Input
              id="medicineName"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Enter medicine name..."
              className="flex-grow text-base py-3 px-4"
              disabled={isLoading}
            />
            <Button 
              type="submit" 
              className="w-full sm:w-auto"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Search"}
            </Button>
          </form>

          <div className="relative mt-6">
            {isLoading && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Searching...</p>
                </div>
              </div>
            )}

            <div className="rounded-lg border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Pharmacy</th>
                    <th className="px-4 py-3 text-left font-semibold">Medicine Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Price</th>
                  </tr>
                </thead>
                <tbody id="resultsBody">
                  {error ? (
                    <tr className="empty-state">
                      <td colSpan={3} className="text-center text-destructive italic p-4">
                        {error}
                      </td>
                    </tr>
                  ) : results.length === 0 ? (
                    searchedTermDisplay && (
                      <tr className="empty-state">
                        <td colSpan={3} className="text-center text-muted-foreground italic p-4">
                          No results found for "<span className="text-primary">{searchedTermDisplay}</span>"
                        </td>
                      </tr>
                    )
                  ) : (
                    results.map((item, index) => (
                      <tr key={index} className="border-t animate-in fade-in">
                        <td className="px-4 py-3 font-medium text-primary">{item.pharmacyName}</td>
                        <td className="px-4 py-3">{item.medicineName}</td>
                        <td className="px-4 py-3 text-lg font-semibold">{item.price}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
