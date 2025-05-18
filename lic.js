const express = require('express');
const router = express.Router();
const db = require('./database');

// Get all licenses
router.get('/licenses', async (req, res) => {
    try {
        const licenses = await db.getAllLicenses();
        res.json(licenses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch licenses' });
    }
});

// Add a new license
router.post('/licenses', async (req, res) => {
    const { hardwareid, serialno, expirydate, status } = req.body;
    try {
        const id = await db.addLicense(hardwareid, serialno, expirydate, status);
        res.status(201).json({ id, message: 'License added successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update a license
router.put('/licenses/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        await db.updateLicense(id, updates);
        res.json({ message: 'License updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete a license
router.delete('/licenses/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.deleteLicense(id);
        res.json({ message: 'License deleted successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Toggle license status
router.put('/licenses/:id/toggle', async (req, res) => {
    const { id } = req.params;
    try {
        await db.toggleLicenseStatus(id);
        res.json({ message: 'License status updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Update a license
router.put('/licenses/update/:serialno', async (req, res) => {
    const { serialno } = req.params;
    const updates = req.body;
    try {
        await db.updateLicenseSr(serialno, updates);
        res.json({ message: 'License updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Toggle license status
router.put('/licenses/toggle/:serialno', async (req, res) => {
    const { serialno } = req.params;  // Changed from id to serialno
    try {
        await db.toggleLicenseStatusSr(serialno);
        res.json({ message: 'License status updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});



module.exports = router;
