export const api = function (url, options = {}) {
    return new Promise(function(resolve, reject) {
        let API_URL = import.meta.env.VITE_API_URL;
        if(options.method === undefined){
            options.method = 'GET';
        }
        if(options.data === undefined){
            options.data = {};
        }
        let init = {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            method: options.method.toUpperCase(),
            mode: 'cors',
            cache: 'no-cache',
            credentials: 'same-origin',
        };
        const access_token = localStorage.getItem('access_token');
        if (access_token) {
            init.headers.Authorization = `Bearer ${access_token}`;
        }
        if (options.data) {
            if(init.method === 'GET'){
                const searchParams = new URLSearchParams();
                Object.entries(options.data).forEach(([key, value]) => {
                    if (Array.isArray(value)) {
                        value.forEach(item => searchParams.append(`${key}[]`, item));
                    }
                    else {
                        searchParams.append(key, value);
                    }
                });
                url += '?' + searchParams.toString();
            }
            else {
                init.body = JSON.stringify(options.data);
            }
        }
        try {
            fetch(API_URL + url, init)
                .then(response => response.json())
                .then(json => {
                    if (json.location) {
                        setTimeout(() => {
                            window.location.href = json.location;
                        }, 500);
                    }
                    resolve(json);
                })
                .catch(error => {
                    console.log(error);
                    reject(error);
                });
        }
        catch (error) {
            console.error(error);
            reject(error);
        }
    });
}
export default api;
