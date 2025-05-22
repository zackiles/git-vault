/**
 * Mock responses for 1Password CLI operations
 * Used in tests to simulate 1Password CLI without requiring an actual installation
 */

/**
 * Interface for a 1Password field
 */
export interface OpField {
  id: string;
  type: string;
  label: string;
  value: string;
  purpose: string | null;
}

/**
 * Interface for a 1Password item
 */
export interface OpItem {
  id: string;
  title: string;
  vault: {
    id: string;
    name: string;
  };
  category: string;
  fields: OpField[];
  created: {
    time: string;
  };
  updated: {
    time: string;
  };
}

/**
 * Mock response for a 1Password item
 * Simulates the JSON structure returned by the 1Password CLI when retrieving an item
 */
export const mockOpItemResponse: OpItem = {
  id: "mock-item-id",
  title: "git-vault-project-hash123",
  vault: {
    id: "mock-vault-id",
    name: "Git-Vault"
  },
  category: "SECURE_NOTE",
  fields: [
    {
      id: "password",
      type: "CONCEALED",
      label: "password",
      value: "testpassword",
      purpose: "PASSWORD"
    },
    {
      id: "path",
      type: "STRING",
      label: "path",
      value: "secret.txt",
      purpose: null
    },
    {
      id: "status",
      type: "STRING",
      label: "status",
      value: "active",
      purpose: null
    }
  ],
  created: {
    time: "2023-01-01T00:00:00Z"
  },
  updated: {
    time: "2023-01-01T00:00:00Z"
  }
};

/**
 * Mock response for a list of 1Password vaults
 * Simulates the JSON structure returned by the 1Password CLI when listing vaults
 */
export const mockOpVaultsResponse = [
  {
    id: "mock-vault-id",
    name: "Git-Vault",
    description: "Vault for storing Git-Vault encrypted file passwords",
    type: "USER_CREATED",
    created: {
      time: "2023-01-01T00:00:00Z"
    },
    updated: {
      time: "2023-01-01T00:00:00Z"
    }
  }
];

/**
 * Mock 1Password CLI class
 * Used to simulate 1Password CLI operations in tests
 */
export class Mock1PasswordCLI {
  private _isSignedIn = true;
  private _items: Record<string, OpItem> = {};

  /**
   * Set the signed-in state of the mock CLI
   */
  setSignedIn(isSignedIn: boolean): void {
    this._isSignedIn = isSignedIn;
  }

  /**
   * Check if the mock CLI is "signed in"
   */
  isSignedIn(): boolean {
    return this._isSignedIn;
  }

  /**
   * Mock the "whoami" command
   */
  whoami(): string {
    if (!this._isSignedIn) {
      throw new Error("Not signed in");
    }
    return JSON.stringify({
      user_uuid: "mock-user-id",
      account_uuid: "mock-account-id",
      url: "https://my.1password.com",
      email: "test@example.com",
      user_type: "REGULAR"
    });
  }

  /**
   * Mock the "item create" command
   */
  createItem(title: string, vault: string, fields: Record<string, string>): string {
    if (!this._isSignedIn) {
      throw new Error("Not signed in");
    }

    const itemId = `item-${Date.now()}`;

    this._items[itemId] = {
      id: itemId,
      title,
      vault: {
        id: "mock-vault-id",
        name: vault
      },
      category: "SECURE_NOTE",
      fields: Object.entries(fields).map(([key, value]) => ({
        id: key,
        type: key === "password" ? "CONCEALED" : "STRING",
        label: key,
        value: value,
        purpose: key === "password" ? "PASSWORD" : null
      })),
      created: {
        time: new Date().toISOString()
      },
      updated: {
        time: new Date().toISOString()
      }
    };

    return JSON.stringify(this._items[itemId]);
  }

  /**
   * Mock the "item get" command
   */
  getItem(title: string, vault: string, field?: string): string {
    if (!this._isSignedIn) {
      throw new Error("Not signed in");
    }

    // Find item by title and vault
    const item = Object.values(this._items).find(
      (item) => item.title === title && item.vault.name === vault
    ) || mockOpItemResponse; // Use mock if not found in our created items

    if (!item) {
      throw new Error(`Item '${title}' not found in vault '${vault}'`);
    }

    if (field) {
      const fieldObj = item.fields.find((f: OpField) => f.label === field);
      if (!fieldObj) {
        throw new Error(`Field '${field}' not found in item '${title}'`);
      }
      return fieldObj.value;
    }

    return JSON.stringify(item);
  }

  /**
   * Mock the "item edit" command
   */
  editItem(title: string, vault: string, fields: Record<string, string>): string {
    if (!this._isSignedIn) {
      throw new Error("Not signed in");
    }

    // Find item by title and vault
    const item = Object.values(this._items).find(
      (item) => item.title === title && item.vault.name === vault
    ) || mockOpItemResponse; // Use mock if not found

    if (!item) {
      throw new Error(`Item '${title}' not found in vault '${vault}'`);
    }

    // Update fields
    for (const [key, value] of Object.entries(fields)) {
      const fieldIndex = item.fields.findIndex((f: OpField) => f.label === key);
      if (fieldIndex !== -1) {
        item.fields[fieldIndex].value = value;
      } else {
        item.fields.push({
          id: key,
          type: key === "password" ? "CONCEALED" : "STRING",
          label: key,
          value: value,
          purpose: key === "password" ? "PASSWORD" : null
        });
      }
    }

    item.updated.time = new Date().toISOString();
    return JSON.stringify(item);
  }
}

/**
 * Create a pre-configured mock 1Password CLI instance
 */
export function createMock1PasswordCLI(): Mock1PasswordCLI {
  return new Mock1PasswordCLI();
}
