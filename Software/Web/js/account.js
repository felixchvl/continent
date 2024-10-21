const isAuth = localStorage.getItem("authorised");

if (isAuth == "True")
{
    window.location.pathname = "../html/auth.html";
}

function auth()
{
    var name = document.querySelector('#registerName').value;
    localStorage.setItem("authorised", "True");
    localStorage.setItem("name", name);

    window.location.pathname = "../html/auth.html";
}