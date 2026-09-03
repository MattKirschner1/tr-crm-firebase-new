import React, { useState, useEffect } from 'react'
import { auth, db } from './firebase-config'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, addDoc, query, where, getDocs, updateDoc, deleteDoc, doc, orderBy } from 'firebase/firestore'
import Papa from 'papaparse'

function App() {
  const [user, setUser] = useState(null)
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [deals, setDeals] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  // Auth state
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        loadDeals(currentUser.uid)
        loadContacts(currentUser.uid)
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const loadDeals = async (userId) => {
    try {
      const q = query(collection(db, 'deals'), where('userId', '==', userId), orderBy('createdAt', 'desc'))
      const snapshot = await getDocs(q)
      setDeals(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (error) {
      console.error('Error loading deals:', error)
    }
  }

  const loadContacts = async (userId) => {
    try {
      const q = query(collection(db, 'contacts'), where('userId', '==', userId))
      const snapshot = await getDocs(q)
      setContacts(snapshot.docs.map(c => ({ id: c.id, ...c.data() })))
    } catch (error) {
      console.error('Error loading contacts:', error)
    }
  }

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  return (
    <div className="app">
      <nav className={`navbar ${menuOpen ? 'open' : ''}`}>
        <div className="navbar-brand">
          <div className="logo-small">TR</div>
          <span className="brand-text">Talent Resources</span>
        </div>
        <div className="nav-menu">
          <button
            className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
            onClick={() => { setCurrentPage('dashboard'); setMenuOpen(false) }}
          >
            📊 <span>Dashboard</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'deals' ? 'active' : ''}`}
            onClick={() => { setCurrentPage('deals'); setMenuOpen(false) }}
          >
            💼 <span>Deals</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'contacts' ? 'active' : ''}`}
            onClick={() => { setCurrentPage('contacts'); setMenuOpen(false) }}
          >
            👥 <span>Contacts</span>
          </button>
        </div>
        <div className="navbar-user">
          <div className="user-info">
            <p className="user-name">{user.displayName || 'User'}</p>
            <p className="user-email">{user.email}</p>
          </div>
          <button className="btn-logout" onClick={() => signOut(auth)}>🚪</button>
        </div>
      </nav>

      <main className="main-content">
        {currentPage === 'dashboard' && <Dashboard deals={deals} contacts={contacts} />}
        {currentPage === 'deals' && <DealsPage deals={deals} contacts={contacts} user={user} onReload={() => loadDeals(user.uid)} onContactAdded={() => loadContacts(user.uid)} />}
        {currentPage === 'contacts' && <ContactsPage contacts={contacts} user={user} onReload={() => loadContacts(user.uid)} />}
      </main>
    </div>
  )
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      let userCredential
      if (isSignup) {
        userCredential = await createUserWithEmailAndPassword(auth, email, password)
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password)
      }
      onLogin(userCredential.user)
    } catch (error) {
      setError(error.message)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-logo">
          <div className="logo-circle">TR</div>
        </div>
        <h1>Talent Resources CRM</h1>
        <p className="login-subtitle">Deal Management Platform</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          {error && <p style={{ color: '#EF4444', fontSize: '14px' }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-large">
            {isSignup ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px' }}>
          {isSignup ? 'Already have an account?' : "Don't have an account?"}
          {' '}
          <button
            onClick={() => { setIsSignup(!isSignup); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isSignup ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}

function Dashboard({ deals, contacts }) {
  const totalRevenue = deals.reduce((sum, d) => sum + (d.feeCharged || 0), 0)
  const totalMargin = deals.reduce((sum, d) => sum + ((d.feeCharged || 0) - (d.feePaid || 0)), 0)

  const currentQuarter = getQuarter(new Date())
  const quarterDeals = deals.filter(d => getQuarter(new Date(d.createdAt)) === currentQuarter)

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">$</div>
          <div>
            <p className="metric-label">Total Revenue</p>
            <p className="metric-value">${(totalRevenue / 1000).toFixed(1)}K</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">M</div>
          <div>
            <p className="metric-label">Gross Margin</p>
            <p className="metric-value">${(totalMargin / 1000).toFixed(1)}K</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">D</div>
          <div>
            <p className="metric-label">Total Deals</p>
            <p className="metric-value">{deals.length}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">Q</div>
          <div>
            <p className="metric-label">Q{currentQuarter} Deals</p>
            <p className="metric-value">{quarterDeals.length}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">C</div>
          <div>
            <p className="metric-label">Contacts</p>
            <p className="metric-value">{contacts.length}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function DealsPage({ deals, contacts, user, onReload, onContactAdded }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [filterQuarter, setFilterQuarter] = useState('all')
  const [showQuickContact, setShowQuickContact] = useState(false)
  const [quickContactData, setQuickContactData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    type: '',
    title: ''
  })
  const [formData, setFormData] = useState({
    brand: '',
    talent: '',
    feePaid: 0,
    feeCharged: 0,
    contactId: '',
    services: '',
    usageRights: '',
    notes: '',
    dealDate: new Date().toISOString().split('T')[0]
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingId) {
        await updateDoc(doc(db, 'deals', editingId), formData)
      } else {
        await addDoc(collection(db, 'deals'), {
          ...formData,
          feePaid: parseFloat(formData.feePaid),
          feeCharged: parseFloat(formData.feeCharged),
          userId: user.uid,
          createdAt: new Date()
        })
      }
      onReload()
      setFormData({ brand: '', talent: '', feePaid: 0, feeCharged: 0, contactId: '', services: '', usageRights: '', notes: '', dealDate: new Date().toISOString().split('T')[0] })
      setEditingId(null)
      setShowForm(false)
    } catch (error) {
      alert('Error saving deal: ' + error.message)
    }
  }

  const handleDelete = async (id) => {
    if (confirm('Delete this deal?')) {
      try {
        await deleteDoc(doc(db, 'deals', id))
        onReload()
      } catch (error) {
        alert('Error deleting deal')
      }
    }
  }

  const openEdit = (deal) => {
    setFormData({ ...deal, dealDate: deal.dealDate || new Date().toISOString().split('T')[0] })
    setEditingId(deal.id)
    setShowForm(true)
  }

  const createQuickContact = async (e) => {
    e.preventDefault()
    try {
      const newContact = await addDoc(collection(db, 'contacts'), {
        ...quickContactData,
        userId: user.uid,
        createdAt: new Date()
      })
      // Auto-select the newly created contact
      setFormData({...formData, contactId: newContact.id})
      // Reset quick contact form
      setQuickContactData({ name: '', email: '', phone: '', company: '', type: '', title: '' })
      setShowQuickContact(false)
      // Reload contacts to show in dropdown immediately
      onContactAdded()
    } catch (error) {
      alert('Error creating contact: ' + error.message)
    }
  }

  const filteredDeals = filterQuarter === 'all'
    ? deals
    : deals.filter(d => getQuarter(new Date(d.dealDate)) === parseInt(filterQuarter))

  const getContactName = (contactId) => {
    if (!contactId) return 'None'
    const contact = contacts.find(c => c.id === contactId)
    return contact ? contact.name : 'Unknown'
  }

  return (
    <div>
      <div className="page-header">
        <h1>Deals</h1>
        <button className="btn btn-primary" onClick={() => { setEditingId(null); setFormData({ brand: '', talent: '', feePaid: 0, feeCharged: 0, contactId: '', services: '', usageRights: '', notes: '', dealDate: new Date().toISOString().split('T')[0] }); setShowForm(!showForm) }}>
          New Deal
        </button>
      </div>

      <div className="search-bar">
        <select value={filterQuarter} onChange={(e) => setFilterQuarter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '14px' }}>
          <option value="all">All Quarters</option>
          <option value="1">Q1</option>
          <option value="2">Q2</option>
          <option value="3">Q3</option>
          <option value="4">Q4</option>
        </select>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Deal' : 'New Deal'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Brand</label>
                  <input type="text" value={formData.brand} onChange={(e) => setFormData({...formData, brand: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Deal Date</label>
                  <input type="date" value={formData.dealDate} onChange={(e) => setFormData({...formData, dealDate: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Talent (comma-separated)</label>
                  <input type="text" value={formData.talent} onChange={(e) => setFormData({...formData, talent: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Contact (optional)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select value={formData.contactId} onChange={(e) => setFormData({...formData, contactId: e.target.value})} style={{ flex: 1 }}>
                      <option value="">Select a contact</option>
                      {contacts.length === 0 && <option disabled>No contacts available</option>}
                      {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.title ? `(${c.title})` : ''}</option>)}
                    </select>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowQuickContact(!showQuickContact)} style={{ whiteSpace: 'nowrap' }}>+ Create</button>
                  </div>
                  {showQuickContact && (
                    <div style={{ marginTop: '12px', padding: '12px', background: 'var(--gray-100)', borderRadius: '6px' }}>
                      <div className="form-grid" style={{ gap: '8px' }}>
                        <div className="form-group" style={{ marginBottom: '8px' }}>
                          <label>Name</label>
                          <input type="text" value={quickContactData.name} onChange={(e) => setQuickContactData({...quickContactData, name: e.target.value})} placeholder="Contact name" required />
                        </div>
                        <div className="form-group" style={{ marginBottom: '8px' }}>
                          <label>Type</label>
                          <select value={quickContactData.type} onChange={(e) => setQuickContactData({...quickContactData, type: e.target.value})} required>
                            <option value="">Select type</option>
                            <option value="Rep">Rep</option>
                            <option value="Brand">Brand</option>
                            <option value="Talent">Talent</option>
                          </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: '8px' }}>
                          <label>Email</label>
                          <input type="email" value={quickContactData.email} onChange={(e) => setQuickContactData({...quickContactData, email: e.target.value})} placeholder="email@example.com" />
                        </div>
                        <div className="form-group" style={{ marginBottom: '8px' }}>
                          <label>Phone</label>
                          <input type="tel" value={quickContactData.phone} onChange={(e) => setQuickContactData({...quickContactData, phone: e.target.value})} placeholder="(555) 123-4567" />
                        </div>
                        <div className="form-group" style={{ marginBottom: '8px' }}>
                          <label>Company</label>
                          <input type="text" value={quickContactData.company} onChange={(e) => setQuickContactData({...quickContactData, company: e.target.value})} placeholder="Company name" />
                        </div>
                        <div className="form-group" style={{ marginBottom: '0' }}>
                          <label>Title</label>
                          <input type="text" value={quickContactData.title} onChange={(e) => setQuickContactData({...quickContactData, title: e.target.value})} placeholder="Job title" />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button type="button" className="btn btn-small btn-primary" onClick={createQuickContact}>Add Contact</button>
                        <button type="button" className="btn btn-small btn-secondary" onClick={() => { setShowQuickContact(false); setQuickContactData({ name: '', email: '', phone: '', company: '', type: '', title: '' }) }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Fee Paid ($)</label>
                  <input type="number" value={formData.feePaid} onChange={(e) => setFormData({...formData, feePaid: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Fee Charged ($)</label>
                  <input type="number" value={formData.feeCharged} onChange={(e) => setFormData({...formData, feeCharged: e.target.value})} />
                </div>
                <div className="form-group full-width">
                  <label>Services (comma-separated)</label>
                  <input type="text" value={formData.services} onChange={(e) => setFormData({...formData, services: e.target.value})} />
                </div>
                <div className="form-group full-width">
                  <label>Usage Rights</label>
                  <input type="text" value={formData.usageRights} onChange={(e) => setFormData({...formData, usageRights: e.target.value})} />
                </div>
                <div className="form-group full-width">
                  <label>Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} style={{ minHeight: '100px', resize: 'vertical' }} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="table-container">
        {filteredDeals.length === 0 ? (
          <div className="empty-state">No deals yet</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Brand</th>
                <th>Date</th>
                <th>Talent</th>
                <th>Contact</th>
                <th>Fee Paid</th>
                <th>Fee Charged</th>
                <th>Margin</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDeals.map(deal => (
                <tr key={deal.id}>
                  <td>{deal.brand}</td>
                  <td>{new Date(deal.dealDate).toLocaleDateString()}</td>
                  <td>{deal.talent}</td>
                  <td>{getContactName(deal.contactId)}</td>
                  <td>${deal.feePaid?.toLocaleString() || 0}</td>
                  <td>${deal.feeCharged?.toLocaleString() || 0}</td>
                  <td style={{ color: 'var(--success)', fontWeight: 'bold' }}>${((deal.feeCharged || 0) - (deal.feePaid || 0)).toLocaleString()}</td>
                  <td>
                    <div className="action-buttons">
                      <button className="btn btn-small btn-primary" onClick={() => openEdit(deal)}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => handleDelete(deal.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ContactsPage({ contacts, user, onReload }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    title: '',
    company: '',
    email: '',
    phone: '',
    notes: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingId) {
        await updateDoc(doc(db, 'contacts', editingId), formData)
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...formData,
          userId: user.uid,
          createdAt: new Date()
        })
      }
      onReload()
      setFormData({ name: '', type: '', title: '', company: '', email: '', phone: '', notes: '' })
      setEditingId(null)
      setShowForm(false)
    } catch (error) {
      alert('Error saving contact: ' + error.message)
    }
  }

  const handleDelete = async (id) => {
    if (confirm('Delete this contact?')) {
      try {
        await deleteDoc(doc(db, 'contacts', id))
        onReload()
      } catch (error) {
        alert('Error deleting contact')
      }
    }
  }

  const openEdit = (contact) => {
    setFormData(contact)
    setEditingId(contact.id)
    setShowForm(true)
  }

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
    (c.phone && c.phone.includes(search)) ||
    (c.company && c.company.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div>
      <div className="page-header">
        <h1>Contacts</h1>
        <button className="btn btn-primary" onClick={() => { setEditingId(null); setFormData({ name: '', type: '', title: '', company: '', email: '', phone: '', notes: '' }); setShowForm(!showForm) }}>
          New Contact
        </button>
      </div>

      <div className="search-bar">
        <input type="text" placeholder="Search by name, email, phone, company..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Contact' : 'New Contact'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})} required>
                    <option value="">Select type</option>
                    <option value="Rep">Rep</option>
                    <option value="Brand">Brand</option>
                    <option value="Talent">Talent</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Title</label>
                  <input type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Company</label>
                  <input type="text" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div className="form-group full-width">
                  <label>Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} style={{ minHeight: '100px', resize: 'vertical' }} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="table-container">
        {filteredContacts.length === 0 ? (
          <div className="empty-state">No contacts yet</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Title</th>
                <th>Company</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.map(contact => (
                <tr key={contact.id}>
                  <td>{contact.name}</td>
                  <td>{contact.type}</td>
                  <td>{contact.title || '-'}</td>
                  <td>{contact.company || '-'}</td>
                  <td>{contact.email || '-'}</td>
                  <td>{contact.phone || '-'}</td>
                  <td>
                    <div className="action-buttons">
                      <button className="btn btn-small btn-primary" onClick={() => openEdit(contact)}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => handleDelete(contact.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function getQuarter(date) {
  const month = date.getMonth() + 1
  return Math.ceil(month / 3)
}

export default App