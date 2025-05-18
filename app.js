const BASE_URL = 'https://api.softwaresrvs.shop/api';

// Add this notification system at the top of app.js
const showNotification = (message, type) => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
};

// Update these action functions to work with the API
const editLicense = (id) => {
    console.log('Editing license:', id); // Debug log
    const license = licenses.find(l => l.id === id);
    
    if (license) {
        // Fill the form with license data
        document.getElementById('hardwareid').value = license.hardwareid;
        document.getElementById('serialno').value = license.serialno;
        document.getElementById('expirydate').value = license.expirydate.split('T')[0];
        document.getElementById('status').value = license.status.toLowerCase();

        // Update form state
        const form = document.getElementById('licenseForm');
        form.dataset.editId = id;
        
        // Update button text
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Update License';

        // Scroll to form
        form.scrollIntoView({ behavior: 'smooth' });
    }
};

const cancelEditing = () => {
    const form = document.getElementById('licenseForm');
    form.reset();
    form.dataset.editId = '';
    
    // Reset submit button text
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.textContent = 'Add License';
    
    // Remove cancel button
    const cancelButton = document.getElementById('cancelEdit');
    if (cancelButton) {
        cancelButton.remove();
    }
};

const toggleLicense = async (id, isActive) => {
    try {
        const response = await fetch(`${BASE_URL}/licenses/${id}/toggle`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            showNotification(`License ${isActive ? 'deactivated' : 'activated'} successfully!`, 'success');
            loadLicenses();
        }
    } catch (error) {
        showNotification('Failed to update license status', 'error');
    }
};

const deleteLicense = async (id) => {
    if (confirm('Are you sure you want to delete this license?')) {
        try {
            const response = await fetch(`${BASE_URL}/licenses/${id}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                showNotification('License deleted successfully!', 'success');
                loadLicenses();
            }
        } catch (error) {
            showNotification('Failed to delete license', 'error');
        }
    }
};

// Update form submission to handle both add and edit
document.getElementById('licenseForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const editId = this.dataset.editId;
    const formData = {
        hardwareid: document.getElementById('hardwareid').value,
        serialno: document.getElementById('serialno').value,
        expirydate: document.getElementById('expirydate').value,
        status: document.getElementById('status').value
    };

    const url = editId 
        ? `${BASE_URL}/licenses/${editId}`
        : `${BASE_URL}/licenses`;
    
    try {
        const response = await fetch(url, {
            method: editId ? 'PUT' : 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (response.ok) {
            showNotification(`License ${editId ? 'updated' : 'added'} successfully!`, 'success');
            this.reset();
            delete this.dataset.editId;
            document.querySelector('button[type="submit"]').textContent = 'Add License';
            await loadLicenses();
        }
    } catch (error) {
        showNotification(`Failed to ${editId ? 'update' : 'add'} license`, 'error');
    }
});


// Add this date formatting function
const formatDate = (dateString) => {
    const date = new Date(dateString);
    const options = { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
    };
    return date.toLocaleDateString('en-GB', options); // Use 'en-GB' for day-month-year format
};

// Add this to your existing JavaScript
document.getElementById('searchInput').addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#license-table-body tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
});

// Update your loadLicenses function to include status
// At the top of your app.js file
let licenses = []; // Define the licenses array globally

// Update the loadLicenses function
// Update the loadLicenses function with proper table structure
const loadLicenses = async () => {
    try {
        const response = await fetch(`${BASE_URL}/licenses`);
        licenses = await response.json(); // Store in global variable
        
        const tableBody = document.querySelector('#license-table-body');
        tableBody.innerHTML = '';

        licenses.forEach((license) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${license.id}</td>
                <td>${license.hardwareid}</td>
                <td>${license.serialno}</td>
                <td>${formatDate(license.expirydate)}</td>
                <td>${license.status}</td>
                <td class="action-buttons">
                    <button class="edit-btn" onclick="editLicense(${license.id})">Edit</button>
                    <button class="toggle-btn" onclick="toggleLicense(${license.id}, ${license.isActive})">
                        ${license.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="delete-btn" onclick="deleteLicense(${license.id})">Delete</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error loading licenses.', 'error');
    }
};

// Update the loadLicenses function's row creation part
licenses.forEach((license) => {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${license.id}</td>
        <td>${license.hardwareid}</td>
        <td>${license.serialno}</td>
        <td>${formatDate(license.expirydate)}</td>
        <td>${license.status}</td>
        <td class="action-buttons">
            <button class="edit-btn" type="button" onclick="editLicense(${license.id})">Edit</button>
            <button class="toggle-btn" type="button" onclick="toggleLicense(${license.id}, ${license.isActive})">
                ${license.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button class="delete-btn" type="button" onclick="deleteLicense(${license.id})">Delete</button>
        </td>
    `;
    tableBody.appendChild(row);
});
// Ensure the DOM is fully loaded before executing the function
document.addEventListener('DOMContentLoaded', loadLicenses);
