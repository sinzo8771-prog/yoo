'use server';

import { gql } from 'graphql-request';
import { openfrontClient } from '../config';
import { parseStoreRecord, type StoreRecord } from '@/lib/security/schemas';

/**
 * Get the first store (assumes single store setup).
 *
 * The response is untrusted input at an API boundary, so it is schema-validated
 * (Task 18) before any field is used: a record that fails validation, or an
 * upstream failure, returns null and every consumer falls back to `lib/brand`
 * defaults instead of rendering values it cannot vouch for.
 */
export async function getStore(): Promise<StoreRecord | null> {
  const query = gql`
    query GetStore {
      stores(take: 1) {
        id
        name
        defaultCurrencyCode
        homepageTitle
        homepageDescription
        logoIcon
        logoColor
        metadata
      }
    }
  `;

  try {
    const response = await openfrontClient.request(query);
    const record = response?.stores?.[0];
    if (!record) return null;

    return parseStoreRecord(record);
  } catch (error) {
    console.error('Error fetching store:', error);
    return null;
  }
}
