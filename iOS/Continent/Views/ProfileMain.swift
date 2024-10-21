//
//  ProfileMain.swift
//  Continent
//
//  Created by Félix Chevalier on 19/02/2024.
//

import SwiftUI


struct ProfileMain: View {
    var body: some View {
            VStack {
                HStack {
                    // Félix Chevalier
                    Text("Félix Chevalier")
                        .font(Font.custom("Halyard Display", size: 32).weight(.medium))
                        .multilineTextAlignment(.leading)
                        .foregroundColor(.black)
                    
                    
                    // Photo de profile
                    Image("Photo de profile")
                        .frame(width: 50, height: 50)
                        .background(Color(red: 0.78, green: 0.78, blue: 0.78))
                    
                }
                
                HStack{
                        // Bouton "Réserver"
                        ZStack{
                            Button(action: {
                                
                                // Vers la page Réservation
                                
                            }, label: {
                                Text("Réserver")
                                    .font(Font.custom("Halyard Display", size: 15))
                                    .multilineTextAlignment(.center)
                                    .foregroundColor(.black)
                                    .frame(width: 100, height: 25)
                                
                            })
                            Rectangle()
                                .foregroundColor(.clear)
                                .frame(width: 125, height: 25)
                                .cornerRadius(5)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 5)
                                        .inset(by: 0.5)
                                        .stroke(.black, lineWidth: 1)
                                )
                                
                            
                        }
                        
                        // Bouton "Historique"
                        ZStack {
                            Button(action: {
                                
                                // Vers la page Historique
                                
                            }, label: {
                                Text("Historique")
                                    .font(Font.custom("Halyard Display", size: 15))
                                    .multilineTextAlignment(.center)
                                    .foregroundColor(.black)
                                    .frame(width: 100, height: 25)
                            })
                                Rectangle()
                                    .foregroundColor(.clear)
                                    .frame(width: 125, height: 25)
                                    .background(.clear)
                                    .cornerRadius(5)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 5)
                                            .inset(by: 0.5)
                                            .stroke(.black, lineWidth: 1)
                                    )
                                    
                    }
                    
                }
                
        }
        .frame(width: 393, height: 186)
        .background(.white)
        .offset(y: 300)
    }
}

#Preview {
    ProfileMain()
}


