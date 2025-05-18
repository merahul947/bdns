const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'licenses.db'), { verbose: console.log });

// Initialize database
db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hardwareid TEXT NOT NULL,
        serialno TEXT UNIQUE NOT NULL,
        expirydate TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        isActive BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

const dbOperations = {
    addLicense: (hardwareid, serialno, expirydate, status = 'active') => {
        const stmt = db.prepare(`
            INSERT INTO licenses (hardwareid, serialno, expirydate, status)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(hardwareid, serialno, expirydate, status);
        return result.lastInsertRowid;
    },

    getAllLicenses: () => {
        const stmt = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC');
        return stmt.all();
    },

    updateLicense: (id, updates) => {
        const fields = Object.keys(updates)
            .map(key => `${key} = @${key}`)
            .join(', ');
        const stmt = db.prepare(`UPDATE licenses SET ${fields} WHERE id = @id`);
        const result = stmt.run({ ...updates, id });
        return result.changes;
    },

    deleteLicense: (id) => {
        const stmt = db.prepare('DELETE FROM licenses WHERE id = ?');
        const result = stmt.run(id);
        return result.changes;
    },

    toggleLicenseStatus: (id) => {
        const stmt = db.prepare('UPDATE licenses SET isActive = NOT isActive WHERE id = ?');
        const result = stmt.run(id);
        return result.changes;
    },

    toggleLicenseStatusSr: (serialno) => {
        const stmt = db.prepare('UPDATE licenses SET isActive = NOT isActive WHERE serialno = ?');
        const result = stmt.run(serialno);
        return result.changes;
    },

    updateLicenseSr: (serialno, updates) => {
        const fields = Object.keys(updates)
            .map(key => `${key} = @${key}`)
            .join(', ');
        const stmt = db.prepare(`UPDATE licenses SET ${fields} WHERE serialno = @serialno`);
        const result = stmt.run({ ...updates, serialno });
        return result.changes;
    },

    // Existing checkLicense (unchanged)
    checkLicense: (serialno, hardwareid, blsExpiry) => {
        const stmt = db.prepare('SELECT expirydate, isActive FROM licenses WHERE serialno = ? AND hardwareid = ?');
        const result = stmt.get(serialno, hardwareid);

        if (!result) return { valid: false, message: "License Not Found" };
        if (!result.isActive) return { valid: false, message: "License Deactivated" };

        const dbExpiryDate = new Date(result.expirydate);
        const headerExpiryDate = new Date(blsExpiry + ' GMT+0000');

        if (dbExpiryDate.toISOString().slice(0, 10) !== headerExpiryDate.toISOString().slice(0, 10)) {
            return { valid: false, message: "Expiry Date Mismatch" };
        }

        const currentDate = new Date();
        if (dbExpiryDate < currentDate) {
            return { valid: false, message: "License Expired" };
        }

        return { valid: true, message: "License Valid" };
    },

    // New function to check license by serialno only
    checkLicenseBySerialNo: (serialno) => {
        const stmt = db.prepare('SELECT expirydate, isActive FROM licenses WHERE serialno = ?');
        const result = stmt.get(serialno);

        if (!result) return { valid: false, message: "License Not Found" };
        if (!result.isActive) return { valid: false, message: "License Deactivated" };

        const dbExpiryDate = new Date(result.expirydate);
        const currentDate = new Date();

        if (dbExpiryDate < currentDate) {
            return { valid: false, message: "License Expired" };
        }

        return { valid: true, message: "License Valid" };
    },

    addBulkLicenses: (licenses) => {
        const stmt = db.prepare(`
            INSERT INTO licenses (hardwareid, serialno, expirydate, status)
            VALUES (?, ?, ?, ?)
        `);

        const insertMany = db.transaction((licenses) => {
            for (const license of licenses) {
                stmt.run(
                    license.hardwareid,
                    license.serialno,
                    license.expirydate,
                    license.status || 'active'
                );
            }
        });

        try {
            insertMany(licenses);
            return true;
        } catch (error) {
            console.error('Bulk insert error:', error);
            throw error;
        }
    },

    validateSerialNumbers: (serials) => {
        const stmt = db.prepare('SELECT serialno FROM licenses WHERE serialno IN (?)');
        const existing = stmt.all(serials.join(','));
        return existing.map(row => row.serialno);
    },

    checkLicenseByMachineId: (machineId) => {
        const stmt = db.prepare('SELECT expirydate, isActive FROM licenses WHERE hardwareid = ?');
        const result = stmt.get(machineId);

        if (!result) return { valid: false, message: "License Not Found" };
        if (!result.isActive) return { valid: false, message: "License Deactivated" };

        const dbExpiryDate = new Date(result.expirydate);
        const currentDate = new Date();

        if (dbExpiryDate < currentDate) {
            return { valid: false, message: "License Expired" };
        }

        return { valid: true, message: "License Valid" };
    }
};

module.exports = dbOperations;
