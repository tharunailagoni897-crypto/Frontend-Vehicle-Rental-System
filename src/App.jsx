import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api'
const emptyRegistration = { firstName: '', lastName: '', email: '', password: '', phone: '', role: 'CUSTOMER' }
const emptyCar = {
  brand: '',
  model: '',
  registrationNumber: '',
  description: '',
  seatingCapacity: 5,
  dailyPrice: '',
  fuelEfficiency: 18,
  imageUrl: '',
  active: true
}

function readStoredAuth() {
  try {
    return JSON.parse(localStorage.getItem('auth') || 'null')
  } catch {
    return null
  }
}

function getErrorMessage(error) {
  const data = error.response?.data
  if (data?.message) return data.message
  if (data?.details) return Object.values(data.details).join('. ')
  return error.message || 'The request could not be completed.'
}

function dateForInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function App() {
  const [cars, setCars] = useState([])
  const [bookings, setBookings] = useState([])
  const [customers, setCustomers] = useState([])
  const [token, setToken] = useState(() => localStorage.getItem('token') || '')
  const [auth, setAuth] = useState(readStoredAuth)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState(emptyRegistration)
  const [booking, setBooking] = useState({
    carId: '',
    pickupDate: dateForInput(),
    returnDate: ''
  })
  const [carForm, setCarForm] = useState(emptyCar)
  const [editingCarId, setEditingCarId] = useState(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('browse')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const api = useMemo(() => axios.create({
    baseURL: API_BASE,
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }), [token])

  const refreshWorkspace = useCallback(async (client = api, user = auth) => {
    const carRequest = user?.role === 'ADMIN'
      ? client.get('/admin/cars')
      : user?.role === 'PROVIDER'
        ? client.get('/provider/cars')
        : client.get('/cars')
    const [carResponse, bookingResponse, customerResponse] = await Promise.all([
      carRequest,
      user ? client.get(user.role === 'ADMIN' ? '/admin/bookings' : user.role === 'PROVIDER' ? '/provider/bookings' : '/bookings') : Promise.resolve({ data: [] }),
      user?.role === 'ADMIN' ? client.get('/admin/users/customers') : Promise.resolve({ data: [] })
    ])
    setCars(carResponse.data)
    setBookings(bookingResponse.data)
    setCustomers(customerResponse.data)
  }, [api, auth])

  useEffect(() => {
    let active = true
    const restoreSession = async () => {
      if (!token) {
        setAuth(null)
        localStorage.removeItem('auth')
        try {
          const response = await api.get('/cars')
          if (active) setCars(response.data)
        } catch (requestError) {
          if (active) setError(getErrorMessage(requestError))
        }
        return
      }

      try {
        const response = await api.get('/users/me')
        if (!active) return
        setAuth(response.data)
        localStorage.setItem('auth', JSON.stringify(response.data))
      } catch {
        if (!active) return
        setToken('')
        setAuth(null)
        localStorage.removeItem('token')
        localStorage.removeItem('auth')
        setError('Your session expired. Please sign in again.')
      }
    }
    restoreSession()
    return () => { active = false }
  }, [api, token])

  useEffect(() => {
    if (!auth) return
    let active = true
    refreshWorkspace().catch((requestError) => {
      if (active) setError(getErrorMessage(requestError))
    })
    return () => { active = false }
  }, [api, auth?.role, refreshWorkspace])

  const filteredCars = cars.filter((car) => {
    const query = search.trim().toLowerCase()
    return !query || `${car.brand} ${car.model} ${car.description}`.toLowerCase().includes(query)
  })

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const path = authMode === 'login' ? '/auth/login' : '/auth/register'
      const payload = authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : authForm
      const response = await api.post(path, payload)
      localStorage.setItem('token', response.data.token)
      localStorage.setItem('auth', JSON.stringify(response.data.user))
      setToken(response.data.token)
      setAuth(response.data.user)
      setAuthForm(emptyRegistration)
      setTab(response.data.user.role === 'ADMIN' || response.data.user.role === 'PROVIDER' ? 'dashboard' : 'browse')
      setNotice(`Signed in as ${response.data.user.firstName}.`)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const handleBookingSubmit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.post('/bookings', {
        carId: Number(booking.carId),
        pickupDate: booking.pickupDate,
        returnDate: booking.returnDate
      })
      setBooking({ carId: '', pickupDate: dateForInput(), returnDate: '' })
      await refreshWorkspace()
      setTab('bookings')
      setNotice('Your booking request was submitted.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const cancelBooking = async (id) => {
    setBusy(true)
    setError('')
    try {
      await api.patch(`/bookings/${id}/cancel`)
      await refreshWorkspace()
      setNotice('Booking cancelled.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('auth')
    setToken('')
    setAuth(null)
    setBookings([])
    setCustomers([])
    setTab('browse')
    setNotice('You have been signed out.')
  }

  const saveCar = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = {
        ...carForm,
        seatingCapacity: Number(carForm.seatingCapacity),
        dailyPrice: Number(carForm.dailyPrice),
        fuelEfficiency: Number(carForm.fuelEfficiency)
      }
      const carPath = auth?.role === 'PROVIDER' ? '/provider/cars' : '/admin/cars'
      if (editingCarId) await api.put(`${carPath}/${editingCarId}`, payload)
      else await api.post(carPath, payload)
      setCarForm(emptyCar)
      setEditingCarId(null)
      await refreshWorkspace()
      setNotice(editingCarId ? 'Car details updated.' : 'Car added to the fleet.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const editCar = (car) => {
    setEditingCarId(car.id)
    setCarForm({
      brand: car.brand,
      model: car.model,
      registrationNumber: car.registrationNumber,
      description: car.description || '',
      seatingCapacity: car.seatingCapacity,
      dailyPrice: car.dailyPrice,
      fuelEfficiency: car.fuelEfficiency,
      imageUrl: car.imageUrl || '',
      active: car.active
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeCar = async (car) => {
    if (!window.confirm(`Remove ${car.brand} ${car.model} from the active fleet?`)) return
    setBusy(true)
    setError('')
    try {
      const carPath = auth?.role === 'PROVIDER' ? '/provider/cars' : '/admin/cars'
      await api.delete(`${carPath}/${car.id}`)
      await refreshWorkspace()
      setNotice('Car removed from the active fleet.')
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const updateBookingStatus = async (id, status) => {
    setBusy(true)
    setError('')
    try {
      const bookingPath = auth?.role === 'PROVIDER' ? '/provider/bookings' : '/admin/bookings'
      await api.patch(`${bookingPath}/${id}/status`, null, { params: { status } })
      await refreshWorkspace()
      setNotice(`Booking updated to ${status.toLowerCase()}.`)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const toggleCustomer = async (customer) => {
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/users/${customer.id}/status`, null, {
        params: { active: !customer.active }
      })
      await refreshWorkspace()
      setNotice(`${customer.firstName} ${customer.active ? 'deactivated' : 'activated'}.`)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const startBooking = (car) => {
    setBooking((current) => ({ ...current, carId: String(car.id) }))
    if (!auth) setNotice('Sign in or create an account to book this car.')
    document.getElementById('booking-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const isAdmin = auth?.role === 'ADMIN'
  const isProvider = auth?.role === 'PROVIDER'

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setTab('browse')} aria-label="DriveNow home">
          <span className="brand-mark">D</span>
          <span>drivenow<span className="brand-dot">.</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          {auth && (isAdmin
            ? [['dashboard', 'Overview'], ['fleet', 'Fleet'], ['adminBookings', 'Bookings'], ['customers', 'Customers']]
            : isProvider
              ? [['dashboard', 'Overview'], ['providerFleet', 'My cars'], ['providerBookings', 'Rental requests']]
              : [['browse', 'Browse cars'], ['bookings', 'My bookings']]
          ).map(([value, label]) => (
            <button className={`nav-link ${tab === value ? 'selected' : ''}`} key={value} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="account-actions">
          {auth ? (
            <>
              <span className="user-greeting">Hi, {auth.firstName}</span>
              <button className="button button-outline button-small" onClick={logout}>Sign out</button>
            </>
          ) : (
            <button className="button button-dark button-small" onClick={() => document.getElementById('auth-panel')?.scrollIntoView({ behavior: 'smooth' })}>Sign in</button>
          )}
        </div>
      </header>

      {error && <div className="flash flash-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="flash flash-success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}

      {!auth && (
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">THE ROAD IS YOURS</p>
            <h1>Find your next<br /><span>great drive.</span></h1>
            <p className="hero-description">Choose a car, pick your dates, and let the journey begin. Straightforward rentals, no surprises.</p>
            <a className="button button-lime" href="#cars">Explore the fleet <span aria-hidden="true">↓</span></a>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="sun-disc" />
            <div className="hero-road" />
            <div className="hero-car">
              <span className="car-window" /><span className="car-wheel wheel-left" /><span className="car-wheel wheel-right" />
            </div>
            <span className="hero-note">YOUR NEXT<br />ADVENTURE</span>
          </div>
        </section>
      )}

      <main>
        {!auth && (
          <section className="panel auth-panel" id="auth-panel">
            <div className="section-heading">
              <div><p className="eyebrow">GET STARTED</p><h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2></div>
              <button className="text-button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError('') }}>
                {authMode === 'login' ? 'New here? Create account' : 'Already registered? Sign in'}
              </button>
            </div>
            <form className="form-grid" onSubmit={handleAuthSubmit}>
              {authMode === 'register' && <>
                <fieldset className="account-type-picker">
                  <legend>I want to...</legend>
                  <button type="button" className={`account-type-card ${authForm.role === 'CUSTOMER' ? 'chosen' : ''}`} onClick={() => setAuthForm({ ...authForm, role: 'CUSTOMER' })}>
                    <span className="account-type-icon" aria-hidden="true">↗</span>
                    <span><strong>Rent a car</strong><small>Browse vehicles and book your next trip.</small></span>
                    <span className="account-type-radio" aria-hidden="true" />
                  </button>
                  <button type="button" className={`account-type-card ${authForm.role === 'PROVIDER' ? 'chosen' : ''}`} onClick={() => setAuthForm({ ...authForm, role: 'PROVIDER' })}>
                    <span className="account-type-icon provider-icon" aria-hidden="true">⌂</span>
                    <span><strong>Provide a car</strong><small>List vehicles and manage rental requests.</small></span>
                    <span className="account-type-radio" aria-hidden="true" />
                  </button>
                </fieldset>
                <label>First name<input required maxLength="50" autoComplete="given-name" value={authForm.firstName} onChange={(event) => setAuthForm({ ...authForm, firstName: event.target.value })} /></label>
                <label>Last name<input required maxLength="50" autoComplete="family-name" value={authForm.lastName} onChange={(event) => setAuthForm({ ...authForm, lastName: event.target.value })} /></label>
              </>}
              <label>Email address<input required type="email" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} /></label>
              {authMode === 'register' && <label>Phone number<input maxLength="20" autoComplete="tel" value={authForm.phone} onChange={(event) => setAuthForm({ ...authForm, phone: event.target.value })} /></label>}
              <label>Password<input required minLength="6" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} /></label>
              <div className="form-action"><button className="button button-dark" disabled={busy}>{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button></div>
            </form>
          </section>
        )}

        {(!auth || !isAdmin) && tab === 'browse' && (
          <>
            <section className="booking-strip" id="booking-panel">
              <div className="booking-strip-title"><span className="booking-icon">↗</span><div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Plan your rental</h2></div></div>
              {auth ? (
                <form className="booking-form" onSubmit={handleBookingSubmit}>
                  <label>Choose a car<select required value={booking.carId} onChange={(event) => setBooking({ ...booking, carId: event.target.value })}>
                    <option value="">Select from fleet</option>{cars.filter((car) => car.active).map((car) => <option key={car.id} value={car.id}>{car.brand} {car.model} — ${car.dailyPrice}/day</option>)}
                  </select></label>
                  <label>Pickup<input required type="date" min={dateForInput()} value={booking.pickupDate} onChange={(event) => setBooking({ ...booking, pickupDate: event.target.value })} /></label>
                  <label>Return<input required type="date" min={booking.pickupDate || dateForInput()} value={booking.returnDate} onChange={(event) => setBooking({ ...booking, returnDate: event.target.value })} /></label>
                  <button className="button button-lime" disabled={busy || !cars.some((car) => car.active)}>Request booking <span aria-hidden="true">→</span></button>
                </form>
              ) : <p className="booking-login-hint">Sign in or create an account above to book a car.</p>}
            </section>
            <section className="fleet-section" id="cars">
              <div className="section-heading fleet-heading">
                <div><p className="eyebrow">PICK YOUR RIDE</p><h2>Our available cars <span className="count-pill">{cars.filter((car) => car.active).length}</span></h2></div>
                <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search cars" placeholder="Search by make or model" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              </div>
              {filteredCars.filter((car) => car.active).length ? (
                <div className="cars-grid">
                  {filteredCars.filter((car) => car.active).map((car, index) => (
                    <article key={car.id} className="car-card">
                      <div className="car-image-wrap">
                        <img src={car.imageUrl || 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=80'} alt={`${car.brand} ${car.model}`} loading="lazy" />
                        <span className="car-number">0{index + 1}</span>
                      </div>
                      <div className="car-card-body">
                        <div className="car-title-row"><div><p className="eyebrow">{car.brand}</p><h3>{car.model}</h3></div><strong className="price">${car.dailyPrice}<small>/day</small></strong></div>
                        <p className="car-description">{car.description || 'A comfortable, reliable ride for your next trip.'}</p>
                        {car.providerName && <p className="provider-attribution">Provided by <strong>{car.providerName}</strong></p>}
                        <div className="car-footer"><span>♙ &nbsp;{car.seatingCapacity} seats</span><button className="button button-dark button-small" onClick={() => startBooking(car)}>{auth ? 'Book this car' : 'Choose this car'} <span aria-hidden="true">→</span></button></div>
                        <TripCalculator car={car} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="empty-state"><h3>No cars found</h3><p>Try a different search or check back soon.</p></div>}
            </section>
          </>
        )}

        {auth && !isAdmin && tab === 'bookings' && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">YOUR TRIPS</p><h2>My bookings</h2></div><span className="count-pill">{bookings.length} total</span></div>
            <BookingList bookings={bookings} isAdmin={false} isProvider={false} busy={busy} onCancel={cancelBooking} onStatusChange={updateBookingStatus} />
          </section>
        )}

        {isProvider && tab === 'dashboard' && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">PROVIDER OVERVIEW</p><h2>Your rental business</h2></div></div>
            <div className="stats-grid">
              <StatCard label="Your vehicles" value={cars.length} detail={`${cars.filter((car) => car.active).length} available to rent`} />
              <StatCard label="Rental requests" value={bookings.length} detail={`${bookings.filter((item) => item.status === 'PENDING').length} awaiting your response`} />
              <StatCard label="Confirmed rentals" value={bookings.filter((item) => item.status === 'CONFIRMED').length} detail="currently confirmed" />
              <StatCard label="Rental earnings" value={`$${bookings.filter((item) => item.status === 'CONFIRMED' || item.status === 'COMPLETED').reduce((sum, item) => sum + Number(item.totalPrice), 0).toFixed(2)}`} detail="confirmed and completed trips" />
            </div>
            <div className="panel table-panel"><div className="table-heading"><h3>Latest rental requests</h3><button className="text-button" onClick={() => setTab('providerBookings')}>View all →</button></div><BookingList bookings={bookings.slice(0, 5)} isAdmin={false} isProvider busy={busy} onCancel={cancelBooking} onStatusChange={updateBookingStatus} /></div>
          </section>
        )}

        {isProvider && tab === 'providerBookings' && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">CUSTOMER RESERVATIONS</p><h2>Rental requests</h2></div><span className="count-pill">{bookings.length} total</span></div>
            <BookingList bookings={bookings} isAdmin={false} isProvider busy={busy} onCancel={cancelBooking} onStatusChange={updateBookingStatus} />
          </section>
        )}

        {isAdmin && tab === 'dashboard' && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">MANAGEMENT OVERVIEW</p><h2>Dashboard</h2></div></div>
            <div className="stats-grid">
              <StatCard label="Fleet vehicles" value={cars.length} detail={`${cars.filter((car) => car.active).length} active`} />
              <StatCard label="Total bookings" value={bookings.length} detail={`${bookings.filter((item) => item.status === 'PENDING').length} awaiting review`} />
              <StatCard label="Customers" value={customers.length} detail={`${customers.filter((customer) => customer.active).length} active accounts`} />
              <StatCard label="Confirmed revenue" value={`$${bookings.filter((item) => item.status === 'CONFIRMED' || item.status === 'COMPLETED').reduce((sum, item) => sum + Number(item.totalPrice), 0).toFixed(2)}`} detail="from confirmed and completed trips" />
            </div>
            <div className="panel table-panel"><div className="table-heading"><h3>Recent bookings</h3><button className="text-button" onClick={() => setTab('adminBookings')}>View all →</button></div><BookingList bookings={bookings.slice(0, 5)} isAdmin isProvider={false} busy={busy} onCancel={cancelBooking} onStatusChange={updateBookingStatus} /></div>
          </section>
        )}

        {((isAdmin && tab === 'fleet') || (isProvider && tab === 'providerFleet')) && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">{isProvider ? 'YOUR RENTAL LISTINGS' : 'VEHICLE MANAGEMENT'}</p><h2>{isProvider ? 'Manage your cars' : 'Manage fleet'}</h2></div><span className="count-pill">{cars.length} vehicles</span></div>
            {isProvider && <p className="provider-live-note">Your active listings are visible to customers as soon as you add them.</p>}
            <div className="admin-layout">
              <form className="panel admin-form" onSubmit={saveCar}>
                <p className="eyebrow">{editingCarId ? 'UPDATE VEHICLE' : isProvider ? 'CREATE LISTING' : 'ADD A VEHICLE'}</p>
                <h3>{editingCarId ? 'Edit car details' : isProvider ? 'List a car for rent' : 'New fleet vehicle'}</h3>
                <label>Make<input required maxLength="50" value={carForm.brand} onChange={(event) => setCarForm({ ...carForm, brand: event.target.value })} /></label>
                <label>Model<input required maxLength="50" value={carForm.model} onChange={(event) => setCarForm({ ...carForm, model: event.target.value })} /></label>
                <label>Registration number<input required maxLength="50" value={carForm.registrationNumber} onChange={(event) => setCarForm({ ...carForm, registrationNumber: event.target.value })} /></label>
                <div className="form-grid compact-grid">
                  <label>Seats<input required type="number" min="1" value={carForm.seatingCapacity} onChange={(event) => setCarForm({ ...carForm, seatingCapacity: event.target.value })} /></label>
                  <label>Daily rate ($)<input required type="number" min="0.01" step="0.01" value={carForm.dailyPrice} onChange={(event) => setCarForm({ ...carForm, dailyPrice: event.target.value })} /></label>
                </div>
                <label>Fuel efficiency (km/L)<input required type="number" min="0.01" step="0.01" value={carForm.fuelEfficiency} onChange={(event) => setCarForm({ ...carForm, fuelEfficiency: event.target.value })} /></label>
                <label>Image URL<input type="url" maxLength="1000" value={carForm.imageUrl} onChange={(event) => setCarForm({ ...carForm, imageUrl: event.target.value })} /></label>
                <label>Description<textarea rows="3" maxLength="1000" value={carForm.description} onChange={(event) => setCarForm({ ...carForm, description: event.target.value })} /></label>
                <label className="checkbox-label"><input type="checkbox" checked={carForm.active} onChange={(event) => setCarForm({ ...carForm, active: event.target.checked })} /> Available for rentals</label>
                <button className="button button-dark" disabled={busy}>{editingCarId ? 'Save changes' : isProvider ? 'Publish car listing' : 'Add to fleet'}</button>
                {editingCarId && <button type="button" className="text-button cancel-edit" onClick={() => { setEditingCarId(null); setCarForm(emptyCar) }}>Cancel edit</button>}
              </form>
              <div className="panel table-panel fleet-table-panel">
                <div className="table-heading"><h3>{isProvider ? 'Your listings' : 'Vehicles'}</h3><span>{cars.length} listed</span></div>
                {cars.length ? <div className="admin-car-list">{cars.map((car) => (
                  <div className="admin-car-row" key={car.id}>
                    <div className="mini-car-image">{car.imageUrl ? <img src={car.imageUrl} alt="" /> : <span>🚘</span>}</div>
                    <div className="admin-car-info"><strong>{car.brand} {car.model}</strong><span>{car.registrationNumber} · ${car.dailyPrice}/day · {car.fuelEfficiency} km/L</span></div>
                    <span className={`status-badge ${car.active ? 'status-confirmed' : 'status-cancelled'}`}>{car.active ? 'Active' : 'Inactive'}</span>
                    <div className="row-actions"><button className="text-button" onClick={() => editCar(car)}>Edit</button>{car.active && <button className="text-button danger-link" disabled={busy} onClick={() => removeCar(car)}>Remove</button>}</div>
                  </div>
                ))}</div> : <div className="empty-state"><h3>No cars listed yet</h3><p>Add your first vehicle to make it available for customer bookings.</p></div>}
              </div>
            </div>
          </section>
        )}

        {isAdmin && tab === 'adminBookings' && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">RESERVATIONS</p><h2>All bookings</h2></div><span className="count-pill">{bookings.length} total</span></div>
            <BookingList bookings={bookings} isAdmin isProvider={false} busy={busy} onCancel={cancelBooking} onStatusChange={updateBookingStatus} />
          </section>
        )}

        {isAdmin && tab === 'customers' && (
          <section className="management-section">
            <div className="section-heading"><div><p className="eyebrow">CUSTOMER ACCOUNTS</p><h2>Manage customers</h2></div><span className="count-pill">{customers.length} total</span></div>
            <div className="panel table-panel"><div className="table-heading"><h3>Registered customers</h3></div>
              {customers.length ? <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Status</th><th /></tr></thead>
                <tbody>{customers.map((customer) => <tr key={customer.id}><td>{customer.firstName} {customer.lastName}</td><td>{customer.email}</td><td>{customer.phone || '—'}</td><td><span className={`status-badge ${customer.active ? 'status-confirmed' : 'status-cancelled'}`}>{customer.active ? 'Active' : 'Inactive'}</span></td><td><button className="text-button" disabled={busy} onClick={() => toggleCustomer(customer)}>{customer.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody>
              </table></div> : <div className="empty-state"><h3>No customers yet</h3><p>New registrations will appear here.</p></div>}
            </div>
          </section>
        )}
      </main>
      <footer className="footer"><a className="brand" href="#"><span className="brand-mark">D</span><span>drivenow<span className="brand-dot">.</span></span></a><span>Good trips start here.</span><span>© {new Date().getFullYear()} DriveNow Rentals</span></footer>
    </div>
  )
}

function StatCard({ label, value, detail }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function TripCalculator({ car }) {
  const [trip, setTrip] = useState({ distance: '120', averageSpeed: '60' })
  const distance = Number(trip.distance)
  const averageSpeed = Number(trip.averageSpeed)
  const mileage = Number(car.fuelEfficiency)
  const valid = distance > 0 && averageSpeed > 0 && mileage > 0
  const travelHours = valid ? distance / averageSpeed : 0
  const fuelRequired = valid ? distance / mileage : 0
  const hourlyRate = Number(car.dailyPrice) / 24
  const estimatedCost = valid ? travelHours * hourlyRate : 0

  return (
    <section className="trip-calculator" aria-label={`Trip estimator for ${car.brand} ${car.model}`}>
      <div className="trip-calculator-heading">
        <div><p className="eyebrow">TRIP ESTIMATOR</p><h4>Plan your drive</h4></div>
        <span className="trip-calculator-mark" aria-hidden="true">↗</span>
      </div>
      <div className="trip-inputs">
        <label>Distance (km)<input type="number" min="1" step="1" value={trip.distance} onChange={(event) => setTrip({ ...trip, distance: event.target.value })} /></label>
        <label>Average speed (km/h)<input type="number" min="1" step="1" value={trip.averageSpeed} onChange={(event) => setTrip({ ...trip, averageSpeed: event.target.value })} /></label>
      </div>
      <div className="trip-results">
        <div><span>Average speed</span><strong>{valid ? `${averageSpeed} km/h` : '—'}</strong></div>
        <div><span>Distance</span><strong>{valid ? `${distance} km` : '—'}</strong></div>
        <div><span>Travel time</span><strong>{valid ? `${travelHours.toFixed(2)} hours` : '—'}</strong></div>
        <div><span>Mileage</span><strong>{mileage > 0 ? `${mileage.toFixed(2)} km/L` : '—'}</strong></div>
        <div><span>Fuel required</span><strong>{valid ? `${fuelRequired.toFixed(2)} litres` : '—'}</strong></div>
      </div>
      <div className="trip-estimate">
        <span>Estimated rental cost</span>
        <strong>{valid ? `$${estimatedCost.toFixed(2)}` : '—'}</strong>
        <small>{valid ? `${travelHours.toFixed(2)} hours × $${hourlyRate.toFixed(2)}/hour. Fuel charges are not included.` : 'Enter a distance and average speed to calculate your trip.'}</small>
      </div>
    </section>
  )
}

function BookingList({ bookings, isAdmin, isProvider, busy, onCancel, onStatusChange }) {
  if (!bookings.length) return <div className="empty-state"><h3>{isProvider ? 'No rental requests yet' : 'No bookings yet'}</h3><p>{isAdmin ? 'Customer reservations will appear here.' : isProvider ? 'Customer requests for your vehicles will appear here.' : 'Your rental requests will show up here.'}</p></div>
  return <div className="booking-list">{bookings.map((item) => (
    <article className="booking-card" key={item.id}>
      <div className="booking-car-mark">🚘</div>
      <div className="booking-main"><div className="booking-title-row"><h3>{item.carName}</h3><span className={`status-badge status-${item.status.toLowerCase()}`}>{item.status}</span></div>
        <p>{item.pickupDate} <span aria-hidden="true">→</span> {item.returnDate}{(isAdmin || isProvider) ? ` · ${item.userName}` : ''}</p>
        <span className="booking-total">${Number(item.totalPrice).toFixed(2)} total · ${Number(item.dailyRateAtBooking).toFixed(2)}/day</span>
      </div>
      <div className="booking-actions">{isAdmin && item.status !== 'CANCELLED' && <>
        {item.status === 'PENDING' && <button className="button button-lime button-small" disabled={busy} onClick={() => onStatusChange(item.id, 'CONFIRMED')}>Confirm</button>}
        {item.status === 'CONFIRMED' && <button className="button button-outline button-small" disabled={busy} onClick={() => onStatusChange(item.id, 'COMPLETED')}>Complete</button>}
        {(item.status === 'PENDING' || item.status === 'CONFIRMED') && <button className="text-button danger-link" disabled={busy} onClick={() => onCancel(item.id)}>Cancel</button>}
      </>}
      {isProvider && item.status !== 'CANCELLED' && item.status !== 'COMPLETED' && <>
        {item.status === 'PENDING' && <button className="button button-lime button-small" disabled={busy} onClick={() => onStatusChange(item.id, 'CONFIRMED')}>Accept request</button>}
        {item.status === 'CONFIRMED' && <button className="button button-outline button-small" disabled={busy} onClick={() => onStatusChange(item.id, 'COMPLETED')}>Mark complete</button>}
        <button className="text-button danger-link" disabled={busy} onClick={() => onStatusChange(item.id, 'CANCELLED')}>Decline</button>
      </>}
      {!isAdmin && (item.status === 'PENDING' || item.status === 'CONFIRMED') && <button className="text-button danger-link" disabled={busy} onClick={() => onCancel(item.id)}>Cancel booking</button>}</div>
    </article>
  ))}</div>
}

export default App
