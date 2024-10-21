const isAuth = localStorage.getItem("authorised");
const name = localStorage.getItem("name");

if (isAuth != "True")
{
    window.location.pathname = "../html/register.html";
}

document.getElementById('authWelcome').textContent = "Welcome, " + name

function signOut()
{
    localStorage.removeItem("authorised");

    window.location.pathname = "../html/index.html";
}